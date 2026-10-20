import { EchoFilter } from "@zara-twin/core";
import {
  AnswerDetector,
  HintEngine,
  meaningHints,
  NudgeDetector,
  ObjectionDetector,
  ScheduleAssistant,
  TalkRatioTracker,
  type Hint,
} from "@zara-twin/hints";
import { TEST_MODE_KEY } from "./meetings/log";
import { MeetingRecorder } from "./meetings/report";
import { ExtensionCalendarProvider } from "./calendar/extensionCalendar";
import { GoogleMeetAdapter } from "./meet/googleMeetAdapter";
import { method, pack } from "./pack";
import {
  isContentMessage,
  MAX_SAVED_LINES,
  type BackgroundMessage,
  type LogsResponse,
  type OffscreenMessage,
  type OffscreenResponse,
  type SaveTranscriptResponse,
  type TranscriptLine,
} from "./shared/messages";
import { UtteranceMerger } from "./transcripts/merge";
import { SAVING_ENABLED_KEY } from "./transcripts/store";
import { CopilotPanel, isPanelPrefs } from "./ui/panel";

/** Мястото на панела и дали разговорът е разгънат (запомня се между срещите). */
const PANEL_PREFS_KEY = "panelPrefs";

// Content script: работи вътре в meet.google.com и само показва състоянието.
// Звукът се прихваща в offscreen документа, а сесията се управлява от service worker-а.
// Подсказките от пакета със знания се изчисляват тук, локално, за милисекунди.
const adapter = new GoogleMeetAdapter();
// Google Calendar (само free/busy) през service worker-а. Ако не е свързан,
// помощникът пак показва конкретната дата на уговорения час.
const calendar = new ExtensionCalendarProvider();
const talkRules = { maxOwnerShare: 0.65, windowMinutes: 3, monologueSeconds: 60, ...method.talkRatio };
const TALK_REFRESH_MS = 1_000;
/** Адресът на таблото (от .env при изграждане) за бутона „Отвори в таблото“ след срещата. */
const DASHBOARD_URL: string = __DASHBOARD_URL__;
/**
 * Разбиране по смисъл: изчакваме толкова след последното парче на клиента, за да е цяло
 * изречението, и питаме модела само ако фразите от пакета не са дали отговор или възражение.
 */
const MEANING_PAUSE_MS = 900;

/** Всичко, което помни какво е показано в текущата среща. Нова среща = чиста памет. */
function freshAssistants() {
  return {
    hints: new HintEngine(pack),
    objections: new ObjectionDetector(method, pack),
    answers: new AnswerDetector(pack),
    nudges: new NudgeDetector(method),
    schedule: new ScheduleAssistant(calendar),
    talk: new TalkRatioTracker({ rules: talkRules }),
    talkShownAt: 0,
    echo: new EchoFilter(),
    merger: new UtteranceMerger(),
    /** Текущото изречение на клиента вече има подсказка по фраза: по смисъл не се пита. */
    lineHinted: false,
    meaningTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    /** Целият текст от срещата (панелът показва само последните 50 реда). Пази се само при „Запази“. */
    lines: [] as TranscriptLine[],
    startedAt: Date.now(),
    /** Обобщението за дневника; създава се, когато е ясен кодът на срещата. */
    recorder: null as MeetingRecorder | null,
  };
}

let meeting = freshAssistants();
let testMode = false;
let reportTimer: ReturnType<typeof setInterval> | undefined;
/** Обобщението се обновява всяка минута: ако табът се затвори внезапно, остава почти пълно. */
const REPORT_EVERY_MS = 60_000;

function showHint(hint: Hint): void {
  panel.showHint(hint);
  meeting.recorder?.onHint(hint, Date.now());
}

/**
 * Праща обобщението и текста на срещата: на компютъра и в таблото, без бутон.
 * Празни и много кратки срещи (проба на звука) не се записват.
 * Тестовите срещи се записват с етикет „Тест“, за да се виждат отделно в таблото.
 */
function saveReport(): void {
  const recorder = meeting.recorder;
  if (!recorder) return;
  const now = Date.now();
  const report = recorder.report(meeting.talk.session(), now, testMode);
  const talked = report.ownerMs + report.counterpartMs;
  if (now - report.startedAt < 60_000 || (talked < 10_000 && report.hints === 0)) return;
  const message: BackgroundMessage = { type: "save-report", report, lines: meeting.lines };
  chrome.runtime.sendMessage(message).catch(() => {});
}

function stopReports(): void {
  clearInterval(reportTimer);
  reportTimer = undefined;
}
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
  onTestMode: (on) => {
    testMode = on;
    void chrome.storage.local.set({ [TEST_MODE_KEY]: on });
    // Сменен по средата на срещата: записът на тази среща веднага взима новия етикет.
    saveReport();
  },
  onPrefsChange: (prefs) => {
    void chrome.storage.local.set({ [PANEL_PREFS_KEY]: prefs }).catch(() => {});
  },
});
panel.mount();
// Мястото на панела и разгънатият разговор от предишната среща.
void chrome.storage.local.get(PANEL_PREFS_KEY).then(
  (stored) => {
    const prefs: unknown = stored[PANEL_PREFS_KEY];
    if (isPanelPrefs(prefs)) panel.applyPrefs(prefs);
  },
  () => {},
);

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!isContentMessage(message)) return;
  switch (message.type) {
    case "session-state":
      if (message.active) {
        // Meet сменя адреса без презареждане (SPA), затова срещата се чете наново.
        const info = adapter.currentMeeting();
        panel.setMeeting(info);
        if (meeting.lines.length === 0) meeting.startedAt = Date.now();
        if (!meeting.recorder && info) meeting.recorder = new MeetingRecorder(info.id, meeting.startedAt);
        void chrome.storage.local.get([SAVING_ENABLED_KEY, TEST_MODE_KEY]).then(
          (stored) => {
            panel.setSaveAvailable(stored[SAVING_ENABLED_KEY] === true);
            testMode = stored[TEST_MODE_KEY] === true;
            panel.setTestMode(testMode);
          },
          () => panel.setSaveAvailable(false),
        );
        if (reportTimer === undefined) reportTimer = setInterval(saveReport, REPORT_EVERY_MS);
        panel.hideSummary();
        panel.setRecording(true);
        panel.show();
      } else {
        const report = meeting.recorder?.report(meeting.talk.session(), Date.now(), testMode);
        stopReports();
        saveReport();
        clearTimeout(meeting.meaningTimer);
        panel.setRecording(false);
        panel.clearHints();
        meeting = freshAssistants();
        // Веднага след срещата: обобщението в панела (затваря се с ×). Кратка проба на звука: нищо.
        if (report && report.endedAt - report.startedAt >= 60_000) {
          panel.showSummary(report, DASHBOARD_URL);
          panel.show();
        } else {
          panel.hide();
        }
      }
      break;
    case "audio-level": {
      panel.setLevel(message.source, message.level);
      const now = Date.now();
      for (const hint of meeting.talk.onLevel(message.source, message.level, now)) showHint(hint);
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
    case "transcript-segment": {
      const now = Date.now();
      // Без слушалки едно изречение идва и от микрофона, и от таба: показваме го веднъж.
      if (meeting.echo.isEcho(message.speaker, message.text, now)) break;
      // Парчетата на същия човек без пауза стават едно изречение: в панела, в записа и за подсказките.
      const line = meeting.merger.add(message.speaker, message.text, now);
      panel.appendSegment({ speaker: message.speaker, text: line.text }, line.merged);
      const last = meeting.lines[meeting.lines.length - 1];
      if (line.merged && last) last.text = line.text;
      else if (meeting.lines.length < MAX_SAVED_LINES) meeting.lines.push({ speaker: message.speaker, text: line.text, at: now });
      if (message.latencyMs !== undefined) panel.setSttLatency(message.latencyMs);
      // Възраженията и роботите се търсят в цялото изречение („трябва да си“ + „помисля“).
      const sentence = { ...message, text: line.text };
      const direct = [...meeting.objections.onSegment(sentence), ...meeting.answers.onSegment(sentence)];
      for (const hint of [...direct, ...meeting.nudges.onSegment(sentence), ...meeting.hints.onSegment(sentence)]) {
        showHint(hint);
      }
      if (message.speaker === "counterpart") askMeaningLater(line.text, line.merged, direct.length > 0);
      // Уговорката има свой прозорец от последните реплики: подава се само новото парче.
      void meeting.schedule.onSegment(message).then((found) => found.forEach(showHint));
      break;
    }
  }
});

/** Когато клиентът спре да говори и фразите не са хванали нищо: тема по смисъл (локален модел). */
function askMeaningLater(text: string, merged: boolean, hinted: boolean): void {
  const current = meeting;
  if (!merged) current.lineHinted = false;
  if (hinted) current.lineHinted = true;
  clearTimeout(current.meaningTimer);
  if (current.lineHinted) return;
  current.meaningTimer = setTimeout(() => {
    const request: OffscreenMessage = { type: "meaning-match", text };
    void chrome.runtime.sendMessage(request).then(
      (response: OffscreenResponse | undefined) => {
        // Срещата е свършила или вече има подсказка по фраза за това изречение.
        if (meeting !== current || current.lineHinted || !response?.ok || !response.match) return;
        const hints = meaningHints(response.match, current.answers, current.objections);
        if (hints.length > 0) current.lineHinted = true;
        hints.forEach(showHint);
      },
      () => {},
    );
  }, MEANING_PAUSE_MS);
}

// Табът се затваря или презарежда по време на срещата: последно обновяване на дневника.
window.addEventListener("pagehide", () => {
  if (reportTimer !== undefined) saveReport();
});
