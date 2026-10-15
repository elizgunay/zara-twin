import type { CopilotMessage } from "./shared/messages";

// Service worker: натискането на иконата е изрично действие на собственика.
// По-късно точно този жест ще разрешава прихващането на звук (tabCapture го изисква).
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined || !tab.url?.startsWith("https://meet.google.com/")) return;

  const message: CopilotMessage = { type: "toggle-panel" };
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // Табът е отворен преди инсталирането на разширението и няма content script.
    console.warn("Zara Copilot: презаредете таба на Meet и опитайте отново.");
  }
});
