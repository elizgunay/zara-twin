import { EchoFilter } from "@zara-twin/core";
import {
  AnswerDetector,
  HintEngine,
  isQuestion,
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
  AI_MAX_TEXT,
  AI_MAX_TURNS,
  type LogsResponse,
  type OffscreenMessage,
  type OffscreenResponse,
  type SaveTranscriptResponse,
  type TranscriptLine,
} from "./shared/messages";
import { UtteranceMerger } from "./transcripts/merge";
import type { AiSuggestion } from "./cloud/cloud";
import { AI_ANSWERS_KEY } from "./meaning/setting";
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
    /** AI отговор: чака ли се, кога е питан последно, показана ли е грешката. */
    aiPending: false,
    aiAt: 0,
    aiErrorShown: false,
    /** Изречение, чакащо реда си към AI (лимитът на безплатния план). */
    aiNext: null as string | null,
    /** Целият текст от срещата (панелът показва само последните 50 реда). Пази се само при „Запази“. */
    lines: [] as TranscriptLine[],
    startedAt: Date.now(),
    /** Обобщението за дневника; създава се, когато е ясен кодът на срещата. */
    recorder: null as MeetingRecorder | null,
  };
}

let meeting = freshAssistants();
let testMode = false;
/** AI отговорите (Опции → AI отговори). По подразбиране включени; без вход в таблото не работят. */
let aiEnabled = true;
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
        void chrome.storage.local.get([SAVING_ENABLED_KEY, TEST_MODE_KEY, AI_ANSWERS_KEY]).then(
          (stored) => {
            aiEnabled = stored[AI_ANSWERS_KEY] !== false;
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
  if (hinted) {
    current.lineHinted = true;
    // Ново изречение с готова карта: чакащото към AI вече е остаряло.
    current.aiNext = null;
  }
  clearTimeout(current.meaningTimer);
  if (current.lineHinted) return;
  current.meaningTimer = setTimeout(() => {
    const request: OffscreenMessage = { type: "meaning-match", text };
    void chrome.runtime.sendMessage(request).then(
      (response: OffscreenResponse | undefined) => {
        // Срещата е свършила или вече има подсказка по фраза за това изречение.
        if (meeting !== current || current.lineHinted) return;
        const hints = response?.ok && response.match ? meaningHints(response.match, current.answers, current.objections) : [];
        if (hints.length > 0) {
          current.lineHinted = true;
          current.aiNext = null;
          hints.forEach(showHint);
          return;
        }
        askAi(text, current);
      },
      () => askAi(text, current),
    );
  }, MEANING_PAUSE_MS);
}

/** Между две питания на AI: безплатният план на модела приема около 1 заявка в секунда. */
const AI_GAP_MS = 3_000;
const words = (text: string) => text.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;

/**
 * Последната стъпка: AI реплика от фактите и сценария (Mistral, ЕС), когато нито фраза, нито смисълът
 * не са дали карта. За всяко изречение на клиента от 3 думи: въпрос → отговор, разказ → следващият
 * въпрос по сценария, колебание → към демо с дата. „Добре“, „Здравейте“ не се пращат.
 * Ако AI още мисли по предишното, новото изречение чака и тръгва веднага след него (само последното).
 */
function askAi(text: string, current: typeof meeting): void {
  if (!aiEnabled || current.lineHinted) return;
  if (words(text) < 3 && !isQuestion(text)) return;
  if (current.aiPending || Date.now() - current.aiAt < AI_GAP_MS) {
    current.aiNext = text;
    if (!current.aiPending) setTimeout(() => flushAi(current), AI_GAP_MS - (Date.now() - current.aiAt));
    return;
  }
  current.aiNext = null;
  current.aiPending = true;
  current.aiAt = Date.now();
  // Контекст: последните реплики преди това изречение, съкратени.
  const before = current.lines.slice(-AI_MAX_TURNS - 1, -1).map((line) => ({
    speaker: line.speaker === "owner" ? ("seller" as const) : ("client" as const),
    text: line.text.slice(0, AI_MAX_TEXT),
  }));
  const request: BackgroundMessage = { type: "ai-suggest", question: text.slice(0, AI_MAX_TEXT), turns: before };
  void chrome.runtime.sendMessage(request).then(
    (response: AiSuggestion | undefined) => {
      current.aiPending = false;
      setTimeout(() => flushAi(current), AI_GAP_MS);
      if (meeting !== current || current.lineHinted) return;
      if (!response?.ok) {
        // Веднъж на среща: защо няма AI отговори (няма вход, липсва ключ…).
        if (response && !current.aiErrorShown) {
          current.aiErrorShown = true;
          panel.setNotice("info", `AI отговорите не работят: ${response.error}`);
        }
        return;
      }
      if (response.say.length === 0) return;
      current.lineHinted = true;
      showHint({ key: `ai:${Date.now()}`, kind: "answer", title: "Отговор", say: response.say, lines: [], byAi: true });
    },
    () => {
      current.aiPending = false;
      setTimeout(() => flushAi(current), AI_GAP_MS);
    },
  );
}

/** Изречението, което е чакало, докато AI отговаряше на предишното. */
function flushAi(current: typeof meeting): void {
  const next = current.aiNext;
  if (!next || meeting !== current || current.aiPending) return;
  current.aiNext = null;
  // Чакалото изречение е последното на клиента: ако междувременно е получило карта, не се праща.
  current.lineHinted = false;
  askAi(next, current);
}

// Табът се затваря или презарежда по време на срещата: последно обновяване на дневника.
window.addEventListener("pagehide", () => {
  if (reportTimer !== undefined) saveReport();
});
