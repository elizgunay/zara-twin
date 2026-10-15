import { HintEngine, ObjectionDetector, ScheduleAssistant, TalkRatioTracker } from "@zara-twin/hints";
import { ExtensionCalendarProvider } from "./calendar/extensionCalendar";
import { GoogleMeetAdapter } from "./meet/googleMeetAdapter";
import { method, pack } from "./pack";
import { isContentMessage, type BackgroundMessage } from "./shared/messages";
import { CopilotPanel } from "./ui/panel";

// Content script: работи вътре в meet.google.com и само показва състоянието.
// Звукът се прихваща в offscreen документа, а сесията се управлява от service worker-а.
// Подсказките от пакета със знания се изчисляват тук, локално, за милисекунди.
const adapter = new GoogleMeetAdapter();
// Google Calendar (само free/busy) през service worker-а. Ако не е свързан,
// помощникът пак показва конкретната дата на уговорения час.
const calendar = new ExtensionCalendarProvider();
const talkRules = { maxOwnerShare: 0.65, windowMinutes: 3, monologueSeconds: 60, ...method.talkRatio };
const TALK_REFRESH_MS = 1_000;

/** Всичко, което помни какво е показано в текущата среща. Нова среща = чиста памет. */
function freshAssistants() {
  return {
    hints: new HintEngine(pack),
    objections: new ObjectionDetector(method, pack),
    schedule: new ScheduleAssistant(calendar),
    talk: new TalkRatioTracker({ rules: talkRules }),
    talkShownAt: 0,
  };
}

let meeting = freshAssistants();
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
        meeting = freshAssistants();
        panel.hide();
      }
      break;
    case "audio-level": {
      panel.setLevel(message.source, message.level);
      const now = Date.now();
      for (const hint of meeting.talk.onLevel(message.source, message.level, now)) panel.showHint(hint);
      if (now - meeting.talkShownAt >= TALK_REFRESH_MS) {
        meeting.talkShownAt = now;
        panel.setTalkShare(meeting.talk.window(now).ownerShare, talkRules.maxOwnerShare);
      }
      break;
    }
    case "capture-notice":
      panel.setNotice(message.tone, message.text);
      panel.show();
      break;
    case "transcript-segment":
      panel.appendSegment(message);
      if (message.latencyMs !== undefined) panel.setSttLatency(message.latencyMs);
      for (const hint of [...meeting.hints.onSegment(message), ...meeting.objections.onSegment(message)]) {
        panel.showHint(hint);
      }
      void meeting.schedule.onSegment(message).then((found) => found.forEach((hint) => panel.showHint(hint)));
      break;
  }
});
