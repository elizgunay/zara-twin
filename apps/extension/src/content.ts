import { HintEngine, ObjectionDetector, ScheduleAssistant } from "@zara-twin/hints";
import { ExtensionCalendarProvider } from "./calendar/extensionCalendar";
import { GoogleMeetAdapter } from "./meet/googleMeetAdapter";
import { method, pack } from "./pack";
import { isContentMessage, type BackgroundMessage } from "./shared/messages";
import { CopilotPanel } from "./ui/panel";

// Content script: работи вътре в meet.google.com и само показва състоянието.
// Звукът се прихваща в offscreen документа, а сесията се управлява от service worker-а.
// Подсказките от пакета със знания се изчисляват тук, локално, за милисекунди.
const adapter = new GoogleMeetAdapter();
let hints = new HintEngine(pack);
let objections = new ObjectionDetector(method, pack);
// Google Calendar (само free/busy) през service worker-а. Ако не е свързан,
// помощникът пак показва конкретната дата на уговорения час.
const calendar = new ExtensionCalendarProvider();
let schedule = new ScheduleAssistant(calendar);
const panel = new CopilotPanel({
  onClose: () => {
    const message: BackgroundMessage = { type: "panel-closed" };
    chrome.runtime.sendMessage(message).catch(() => {});
  },
});
panel.mount();

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!isContentMessage(message)) return;
  switch (message.type) {
    case "session-state":
      if (message.active) {
        // Meet сменя адреса без презареждане (SPA), затова срещата се чете наново.
        panel.setMeeting(adapter.currentMeeting());
        panel.setRecording(true);
        panel.show();
      } else {
        panel.setRecording(false);
        panel.clearHints();
        // Нова среща = чиста памет за повторенията на подсказки.
        hints = new HintEngine(pack);
        objections = new ObjectionDetector(method, pack);
        schedule = new ScheduleAssistant(calendar);
        panel.hide();
      }
      break;
    case "audio-level":
      panel.setLevel(message.source, message.level);
      break;
    case "capture-notice":
      panel.setNotice(message.tone, message.text);
      panel.show();
      break;
    case "transcript-segment":
      panel.appendSegment(message);
      for (const hint of [...hints.onSegment(message), ...objections.onSegment(message)]) panel.showHint(hint);
      void schedule.onSegment(message).then((found) => found.forEach((hint) => panel.showHint(hint)));
      break;
  }
});
