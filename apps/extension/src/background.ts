import { fetchBusy } from "./calendar/google";
import { forgetToken, getStoredToken, GOOGLE_CLIENT_ID, isConnected, signIn } from "./calendar/token";
import { parseMeetCode } from "./meet/meetUrl";
import {
  isBackgroundMessage,
  type BackgroundMessage,
  type CalendarBusyResponse,
  type ContentMessage,
  type OffscreenMessage,
  type MicProblem,
  type OffscreenResponse,
} from "./shared/messages";
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
    let response: OffscreenResponse | undefined;
    for (const { withVideo } of CAPTURE_ATTEMPTS) {
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
      const start: OffscreenMessage = { type: "offscreen-start", streamId, stt, withVideo };
      response = (await chrome.runtime.sendMessage(start)) as OffscreenResponse | undefined;
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
    await notifyTab(tabId, { type: "session-state", active: true });
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
async function sttChoice(): Promise<SttChoice> {
  const stored: unknown = (await chrome.storage.local.get(STT_CHOICE_STORAGE_KEY))[STT_CHOICE_STORAGE_KEY];
  return isSttChoice(stored) ? stored : "auto";
}

async function handleMessage(
  message: Exclude<BackgroundMessage, { type: "calendar-busy" }>,
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

async function notifyTab(tabId: number, message: ContentMessage): Promise<void> {
  // Табът може да е затворен или да е отворен преди инсталацията (без content script).
  await chrome.tabs.sendMessage(tabId, message).catch(() => {});
}
