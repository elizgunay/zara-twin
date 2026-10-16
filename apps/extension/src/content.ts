import { EchoFilter } from "@zara-twin/core";
import { HintEngine, ObjectionDetector, ScheduleAssistant, TalkRatioTracker } from "@zara-twin/hints";
import { ExtensionCalendarProvider } from "./calendar/extensionCalendar";
import { GoogleMeetAdapter } from "./meet/googleMeetAdapter";
import { method, pack } from "./pack";
import {
  isContentMessage,
  MAX_SAVED_LINES,
  type BackgroundMessage,
  type LogsResponse,
  type SaveTranscriptResponse,
  type TranscriptLine,
} from "./shared/messages";
import { SAVING_ENABLED_KEY } from "./transcripts/store";
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
    echo: new EchoFilter(),
    /** Целият текст от срещата (панелът показва само последните 50 реда). Пази се само при „Запази“. */
    lines: [] as TranscriptLine[],
    startedAt: Date.now(),
  };
}

let meeting = freshAssistants();
const panel = new CopilotPanel({
  onClose: () => {
    const message: BackgroundMessage = { type: "panel-closed" };
    chrome.runtime.sendMessage(message).catch(() => {});
  },
  onLogs: async () => {
    const request: BackgroundMessage = { type: "logs-request" };
    const response = (await chrome.runtime.sendMessage(request)) as LogsResponse | undefined;
    return response?.lines ?? ["(няма отговор от разширението)"];
  },
  onSave: async () => {
    const code = adapter.currentMeeting()?.id;
    if (!code) return { tone: "error", text: "Няма активна среща за запазване." };
    if (meeting.lines.length === 0) return { tone: "info", text: "Още няма текст от разговора за запазване." };
    const request: BackgroundMessage = { type: "save-transcript", meetingCode: code, startedAt: meeting.startedAt, lines: meeting.lines };
    const response = (await chrome.runtime.sendMessage(request).catch(() => undefined)) as SaveTranscriptResponse | undefined;
    if (!response?.ok) return { tone: "error", text: `Текстът не се запази: ${response?.error ?? "няма отговор от разширението"}` };
    return {
      tone: "info",
      text: `Запазени ${response.count} реда на този компютър. Изтриват се след ${response.retentionDays} дни (Опции → Запазени срещи). Натиснете отново в края на срещата за целия текст.`,
    };
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
        if (meeting.lines.length === 0) meeting.startedAt = Date.now();
        void chrome.storage.local
          .get(SAVING_ENABLED_KEY)
          .then((stored) => panel.setSaveAvailable(stored[SAVING_ENABLED_KEY] === true), () => panel.setSaveAvailable(false));
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
    case "mic-problem":
      panel.setMicProblem(message.text);
      panel.show();
      break;
    case "transcript-segment":
      // Без слушалки едно изречение идва и от микрофона, и от таба: показваме го веднъж.
      if (meeting.echo.isEcho(message.speaker, message.text, Date.now())) break;
      panel.appendSegment(message);
      if (meeting.lines.length < MAX_SAVED_LINES) meeting.lines.push({ speaker: message.speaker, text: message.text, at: Date.now() });
      if (message.latencyMs !== undefined) panel.setSttLatency(message.latencyMs);
      for (const hint of [...meeting.hints.onSegment(message), ...meeting.objections.onSegment(message)]) {
        panel.showHint(hint);
      }
      void meeting.schedule.onSegment(message).then((found) => found.forEach((hint) => panel.showHint(hint)));
      break;
  }
});
