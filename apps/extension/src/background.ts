import { parseMeetCode } from "./meet/meetUrl";
import {
  isBackgroundMessage,
  type BackgroundMessage,
  type ContentMessage,
  type OffscreenMessage,
  type OffscreenResponse,
} from "./shared/messages";

// Service worker: управлява сесията. Иконата на разширението е единственият начин
// за старт и стоп. Това е изрично действие на собственика и точно то позволява
// chrome.tabCapture да прихване звука на таба.
//
// Правило: звукът се прихваща само докато панелът е видим. Затварянето на панела,
// на таба или излизането от срещата спира прихващането.

const SESSION_KEY = "captureTabId";
const OFFSCREEN_URL = "offscreen.html";

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined || parseMeetCode(tab.url ?? "") === null) return;
  const activeTab = await getSessionTab();
  if (activeTab !== null) await stopSession();
  if (activeTab !== tab.id) await startSession(tab.id);
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (!isBackgroundMessage(message)) return;
  void handleMessage(message, sender);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if ((await getSessionTab()) === tabId) await stopSession();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.url === undefined || parseMeetCode(changeInfo.url) !== null) return;
  if ((await getSessionTab()) === tabId) await stopSession();
});

async function startSession(tabId: number): Promise<void> {
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    await ensureOffscreen();
    const start: OffscreenMessage = { type: "offscreen-start", streamId };
    const response = (await chrome.runtime.sendMessage(start)) as OffscreenResponse | undefined;
    if (!response?.ok) throw new Error(response?.error ?? "Offscreen документът не отговори.");

    await chrome.storage.session.set({ [SESSION_KEY]: tabId });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#d93025" });
    await chrome.action.setBadgeText({ tabId, text: "REC" });
    await notifyTab(tabId, { type: "session-state", active: true });
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

async function handleMessage(message: BackgroundMessage, sender: chrome.runtime.MessageSender): Promise<void> {
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

  if (message.code === "mic-permission-denied") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
    await notifyTab(tabId, {
      type: "capture-notice",
      tone: "info",
      text: "Микрофонът не е разрешен. Отворих страница за разрешение. Засега се чува само събеседникът.",
    });
  } else {
    await notifyTab(tabId, {
      type: "capture-notice",
      tone: "info",
      text: "Микрофонът не е достъпен. Засега се чува само събеседникът.",
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
