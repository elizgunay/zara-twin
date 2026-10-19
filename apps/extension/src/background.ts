import { fetchBusy } from "./calendar/google";
import { forgetToken, getStoredToken, GOOGLE_CLIENT_ID, isConnected, signIn } from "./calendar/token";
import { parseMeetCode } from "./meet/meetUrl";
import {
  isBackgroundMessage,
  type BackgroundMessage,
  type CalendarBusyResponse,
  type LogsResponse,
  type SaveTranscriptResponse,
  type ContentMessage,
  type OffscreenMessage,
  type MicProblem,
  type OffscreenResponse,
} from "./shared/messages";
import { log, logLines } from "./shared/log";
import { SAVING_ENABLED_KEY, TranscriptStore } from "./transcripts/store";
import { MeetingLog } from "./meetings/log";
import type { MeetingReport } from "./meetings/report";
import { uploadReports } from "./cloud/cloud";
import { BUILT_IN_SPEECHMATICS_KEY } from "./stt/builtInKey";
import { resolveCloudStt, SPEECHMATICS_KEY_STORAGE_KEY, STT_MODE_STORAGE_KEY, type CloudStt } from "./stt/cloud";
import { isSttChoice, STT_CHOICE_STORAGE_KEY, type SttChoice } from "./stt/choices";

// Service worker: управлява сесията. Иконата на разширението е единственият начин
// за старт и стоп. Това е изрично действие на собственика и точно то позволява
// chrome.tabCapture да прихване звука на таба.
//
// Правило: звукът се прихваща само докато панелът е видим. Затварянето на панела,
// на таба или излизането от срещата спира прихващането.

const SESSION_KEY = "captureTabId";
const OFFSCREEN_URL = "offscreen.html";

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined) return;
  if (parseMeetCode(tab.url ?? "") === null) {
    // На meet.google.com, но не в среща (напр. началната страница): казваме какво да се направи.
    // На други сайтове няма content script и съобщението просто не стига никъде.
    if (tab.url?.startsWith("https://meet.google.com/")) {
      await notifyTab(tab.id, {
        type: "capture-notice",
        tone: "info",
        text: "Първо влезте в среща в Google Meet, после натиснете иконата на Zara Copilot отново.",
      });
    }
    return;
  }
  const activeTab = await getSessionTab();
  if (activeTab !== null) await stopSession();
  if (activeTab !== tab.id) await startSession(tab.id);
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isBackgroundMessage(message)) return;
  if (message.type === "calendar-busy") {
    // Календарът се пита само от таб с активна среща в Meet.
    if (sender.tab === undefined || parseMeetCode(sender.tab.url ?? "") === null) return;
    calendarBusy(message.start, message.end).then(sendResponse);
    return true; // отговорът е асинхронен
  }
  if (message.type === "save-transcript") {
    // Само от таб с активна среща в Meet.
    if (sender.tab === undefined || parseMeetCode(sender.tab.url ?? "") === null) return;
    saveTranscript(message.meetingCode, message.startedAt, message.lines).then(sendResponse);
    return true;
  }
  if (message.type === "save-report") {
    // Само от таба на същата среща в Meet.
    if (sender.tab === undefined || parseMeetCode(sender.tab.url ?? "") !== message.report.meetingCode) return;
    saveReport(message.report).then(sendResponse);
    return true;
  }
  if (message.type === "logs-request") {
    if (sender.tab === undefined) return;
    collectLogs().then(sendResponse);
    return true;
  }
  void handleMessage(message, sender);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if ((await getSessionTab()) === tabId) await stopSession();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.url === undefined || parseMeetCode(changeInfo.url) !== null) return;
  if ((await getSessionTab()) === tabId) await stopSession();
});

/**
 * Опитите за прихващане: първо само звук, после звук + картина (както в официалния пример
 * на Chrome). Всеки опит взима ново разрешение: streamId е за едно ползване и за няколко секунди.
 */
const CAPTURE_ATTEMPTS = [{ withVideo: false }, { withVideo: true }];

async function startSession(tabId: number): Promise<void> {
  try {
    // Редът е важен (както в официалния пример на Chrome): първо offscreen документът и
    // настройките, а разрешението за прихващане най-накрая, точно преди да се ползва.
    // Обратният ред даваше „AbortError: Error starting tab capture“: разрешението изтичаше,
    // докато offscreen документът се зареждаше (видяно на Mac).
    await ensureOffscreen();
    const stt = await sttChoice();
    const cloud = await readCloudStt();
    let response: OffscreenResponse | undefined;
    for (const { withVideo } of CAPTURE_ATTEMPTS) {
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
      const start: OffscreenMessage = { type: "offscreen-start", streamId, stt, withVideo, ...(cloud && { cloud }) };
      response = (await chrome.runtime.sendMessage(start)) as OffscreenResponse | undefined;
      log("background", "отговор от offscreen", { withVideo, response });
      if (response?.ok) break;
    }
    if (!response?.ok) {
      // Подробности за диагностика: версията на Chrome и броят опити се виждат на снимката от клиента.
      const chrome_ = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] ?? "?";
      throw new Error(
        `(Chrome ${chrome_}, ${CAPTURE_ATTEMPTS.length} опита: само звук и звук + картина) ${response?.error ?? "Offscreen документът не отговори."}`,
      );
    }

    await chrome.storage.session.set({ [SESSION_KEY]: tabId });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#d93025" });
    await chrome.action.setBadgeText({ tabId, text: "REC" });
    await showPanel(tabId);
    if (response.mic) await reportMic(tabId, response.mic);
  } catch (error) {
    await closeOffscreen();
    await notifyTab(tabId, {
      type: "capture-notice",
      tone: "error",
      text: `Звукът на срещата не може да се прихване. ${error instanceof Error ? error.message : ""}`.trim(),
    });
  }
}

async function stopSession(): Promise<void> {
  const tabId = await getSessionTab();
  await chrome.storage.session.remove(SESSION_KEY);
  await closeOffscreen();
  if (tabId === null) return;
  await chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  await notifyTab(tabId, { type: "session-state", active: false });
}

async function calendarBusy(start: number, end: number): Promise<CalendarBusyResponse> {
  if (!GOOGLE_CLIENT_ID) return { ok: false, error: "not-configured" };
  let token = await getStoredToken();
  if (token === null) {
    // Тих опит за нов токен, само ако ръководителят вече е свързал календара от настройките.
    if (!(await isConnected())) return { ok: false, error: "not-connected" };
    try {
      token = await signIn(false);
    } catch {
      return { ok: false, error: "not-connected" };
    }
  }
  try {
    const busy = await fetchBusy(token.accessToken, { start: new Date(start), end: new Date(end) });
    return { ok: true, busy: busy.map((range) => ({ start: range.start.getTime(), end: range.end.getTime() })) };
  } catch (error) {
    if (error instanceof Error && error.message === "unauthorized") {
      await forgetToken();
      return { ok: false, error: "not-connected" };
    }
    return { ok: false, error: "failed" };
  }
}

/** Вариантът, избран от теста на компютъра; без тест: „auto“ (по видеокартата). */
/** Облакът се ползва само при изричен избор в настройките и записан ключ. */
async function readCloudStt(): Promise<CloudStt | null> {
  const stored = await chrome.storage.local.get([STT_MODE_STORAGE_KEY, SPEECHMATICS_KEY_STORAGE_KEY]);
  return resolveCloudStt(stored[STT_MODE_STORAGE_KEY], stored[SPEECHMATICS_KEY_STORAGE_KEY], BUILT_IN_SPEECHMATICS_KEY);
}

async function sttChoice(): Promise<SttChoice> {
  const stored: unknown = (await chrome.storage.local.get(STT_CHOICE_STORAGE_KEY))[STT_CHOICE_STORAGE_KEY];
  return isSttChoice(stored) ? stored : "auto";
}

async function handleMessage(
  message: Exclude<BackgroundMessage, { type: "calendar-busy" | "logs-request" | "save-transcript" | "save-report" }>,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  const tabId = await getSessionTab();
  if (message.type === "panel-closed") {
    if (sender.tab?.id !== undefined && sender.tab.id === tabId) await stopSession();
    return;
  }

  // Съобщенията offscreen-* се приемат само от нашия offscreen документ, не от страница.
  if (sender.tab !== undefined || sender.url !== chrome.runtime.getURL(OFFSCREEN_URL)) return;
  if (tabId === null) return;

  if (message.type === "offscreen-level") {
    await notifyTab(tabId, { type: "audio-level", source: message.source, level: message.level });
    return;
  }

  if (message.type === "offscreen-transcript") {
    await notifyTab(tabId, {
      type: "transcript-segment",
      speaker: message.speaker,
      text: message.text,
      ...(message.latencyMs !== null && { latencyMs: message.latencyMs }),
    });
    return;
  }

  if (message.type === "offscreen-status") {
    await notifyTab(tabId, { type: "capture-notice", tone: message.tone, text: message.text });
    return;
  }

  await reportMic(tabId, message);
}

async function reportMic(tabId: number, mic: MicProblem): Promise<void> {
  if (mic.code === "mic-permission-denied") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
    await notifyTab(tabId, {
      type: "mic-problem",
      text: "Микрофонът не е разрешен: отворих страница за разрешение. След това спрете и пуснете Copilot отново. Засега се чува само събеседникът.",
    });
  } else {
    await notifyTab(tabId, {
      type: "mic-problem",
      text: `Микрофонът не е достъпен (${mic.detail}). Засега се чува само събеседникът.`,
    });
  }
}

/** Дневникът на срещите: обобщения без текст, на този компютър, 90 дни. */
const meetingLog = new MeetingLog(chrome.storage.local);
/** Записите вървят един след друг: иначе две почти едновременни обновявания се презаписват. */
let reportQueue: Promise<unknown> = Promise.resolve();

function saveReport(report: MeetingReport): Promise<{ ok: boolean }> {
  const run = reportQueue.then(async () => {
    // Тестовите срещи също се записват: етикетът „Тест“ е в самото обобщение (report.test).
    await meetingLog.save(report);
    // И в таблото, ако сте влезли (Опции → Табло). Грешка там не спира дневника на компютъра.
    await uploadReports([report]).catch(() => null);
    return { ok: true };
  });
  reportQueue = run.catch(() => {});
  return run.catch(() => ({ ok: false }));
}

/** Запазените срещи: само на този компютър, със срок за автоматично изтриване. */
const transcripts = new TranscriptStore(chrome.storage.local);
// Изтриване на изтеклите записи при всяко събуждане на service worker-а.
void transcripts.prune().catch(() => {});

async function saveTranscript(
  meetingCode: string,
  startedAt: number,
  lines: { speaker: "owner" | "counterpart"; text: string; at: number }[],
): Promise<SaveTranscriptResponse> {
  try {
    // Втора защита: без включено запазване в Опции нищо не се записва.
    if ((await chrome.storage.local.get(SAVING_ENABLED_KEY))[SAVING_ENABLED_KEY] !== true) {
      return { ok: false, error: "запазването е изключено (Опции → Запазени срещи)" };
    }
    const saved = await transcripts.save({ meetingCode, startedAt, lines });
    // В лога влиза само броят редове, никога текстът.
    log("background", "запазена среща", meetingCode, saved.lines.length, "реда");
    return { ok: true, count: saved.lines.length, retentionDays: await transcripts.retentionDays() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Логовете на service worker-а и на offscreen документа (с worker-а), подредени по час. */
async function collectLogs(): Promise<LogsResponse> {
  const request: OffscreenMessage = { type: "offscreen-logs" };
  const offscreen = (await chrome.runtime.sendMessage(request).catch(() => undefined)) as OffscreenResponse | undefined;
  const fromOffscreen = offscreen?.ok ? (offscreen.logs ?? []) : ["(offscreen документът не е отворен)"];
  const header = `Zara Copilot ${chrome.runtime.getManifest().version}, ${navigator.userAgent}. Логовете са събрани в ${new Date().toISOString().slice(11, 19)}`;
  return { lines: [header, ...[...logLines().map((line) => `[bg] ${line}`), ...fromOffscreen].sort(byTime)] };
}

function byTime(a: string, b: string): number {
  const time = (line: string) => /\d\d:\d\d:\d\d\.\d{3}/.exec(line)?.[0] ?? "";
  return time(a).localeCompare(time(b));
}

async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Прихващане на звука от срещата в Google Meet за транскрипция на живо.",
  });
}

async function closeOffscreen(): Promise<void> {
  const stop: OffscreenMessage = { type: "offscreen-stop" };
  await chrome.runtime.sendMessage(stop).catch(() => {});
  await chrome.offscreen.closeDocument().catch(() => {});
}

async function getSessionTab(): Promise<number | null> {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  const value: unknown = stored[SESSION_KEY];
  return typeof value === "number" ? value : null;
}

async function notifyTab(tabId: number, message: ContentMessage): Promise<boolean> {
  // Табът може да е затворен или да е отворен преди инсталацията (без content script).
  return chrome.tabs.sendMessage(tabId, message).then(
    () => true,
    () => false,
  );
}

/**
 * Показва панела. Ако табът на Meet е отворен отпреди инсталацията или презареждането
 * на разширението, в него няма работещ content script: добавяме го и опитваме пак.
 */
async function showPanel(tabId: number): Promise<void> {
  const state: ContentMessage = { type: "session-state", active: true };
  if (await notifyTab(tabId, state)) return;
  log("background", "няма content script в таба, добавям го");
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch (error) {
    log("background", "content script не се добави", error);
    return;
  }
  if (!(await notifyTab(tabId, state))) log("background", "панелът пак не отговаря");
}
