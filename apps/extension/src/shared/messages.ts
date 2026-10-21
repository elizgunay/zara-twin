import type { AudioSourceKind, SpeakerRole } from "@zara-twin/core";
import { MEANING_MODELS, type MeaningMatch, type MeaningModelId } from "@zara-twin/hints";
import { isMeetingReport, type MeetingReport } from "../meetings/report";
import { isSttChoice, type SttChoice } from "../stt/choices";
import { isCloudStt, type CloudStt } from "../stt/cloud";

/**
 * Съобщенията между частите на разширението, групирани по получател.
 * Всяко входящо съобщение минава през съответния is…Message, преди да се изпълни.
 *
 *   иконата → background → offscreen (прихваща звука)
 *                 ↑   ↓
 *          content script (панелът в Meet)
 */

export type CaptureErrorCode =
  | "mic-permission-denied"
  | "mic-unavailable"
  | "tab-capture-failed";

/** Към content script-а в таба на Meet. */
export type ContentMessage =
  | { type: "session-state"; active: boolean }
  | { type: "audio-level"; source: AudioSourceKind; level: number }
  | { type: "capture-notice"; tone: "info" | "error"; text: string }
  /** Проблем с микрофона: стои в панела, докато трае сесията, не се заменя от други съобщения. */
  | { type: "mic-problem"; text: string }
  /** latencyMs: от края на изречението до текста; служи за диагностика в пилота. */
  | { type: "transcript-segment"; speaker: SpeakerRole; text: string; latencyMs?: number };

/** Горна граница за едно изречение: защита срещу огромни съобщения. */
export const MAX_SEGMENT_LENGTH = 2000;

/** Към service worker-а. */
export type BackgroundMessage =
  | { type: "panel-closed" }
  | { type: "offscreen-level"; source: AudioSourceKind; level: number }
  | { type: "offscreen-error"; code: CaptureErrorCode; detail: string }
  | { type: "offscreen-transcript"; speaker: SpeakerRole; text: string; latencyMs: number | null }
  | { type: "offscreen-status"; tone: "info" | "error"; text: string }
  /** От content script-а: заетите интервали в календара (милисекунди от епохата). */
  | { type: "calendar-busy"; start: number; end: number }
  /** От панела: логовете от всички части (бутон „Логове“). */
  | { type: "logs-request" }
  /** От панела: запазване на текста от срещата (бутон „Запази“), само на този компютър. */
  | { type: "save-transcript"; meetingCode: string; startedAt: number; lines: TranscriptLine[] }
  /** От панела: обобщението и текстът на срещата, автоматично всяка минута и в края ѝ. */
  | { type: "save-report"; report: MeetingReport; lines: TranscriptLine[] }
  /** От панела: въпрос на клиента без готова карта → AI отговор от фактите на фирмата. */
  | { type: "ai-suggest"; question: string; turns: { speaker: "client" | "seller"; text: string }[] };

/** Колко реплики преди въпроса отиват към AI (за контекст), и колко дълги. */
export const AI_MAX_TURNS = 6;
export const AI_MAX_TEXT = 300;

export interface TranscriptLine {
  speaker: SpeakerRole;
  text: string;
  at: number;
  /** Картите, които Copilot показа за този ред: за преглед в таблото след срещата. */
  cards?: LineCard[];
}

/** Кратко копие на подсказката: заглавие, репликите и откъде е дошла. */
export interface LineCard {
  title: string;
  say?: string[];
  /** phrase = готова карта, meaning = по смисъл, ai = съставена от AI. */
  via: "phrase" | "meaning" | "ai";
}

export const MAX_CARDS_PER_LINE = 4;
const VIA: ReadonlySet<unknown> = new Set(["phrase", "meaning", "ai"]);

function isLineCards(value: unknown): boolean {
  if (value === undefined) return true;
  return (
    Array.isArray(value) &&
    value.length <= MAX_CARDS_PER_LINE &&
    value.every(
      (card: unknown) =>
        isRecord(card) &&
        typeof card.title === "string" &&
        card.title.length <= 120 &&
        VIA.has(card.via) &&
        (card.say === undefined || (Array.isArray(card.say) && card.say.length <= 2 && card.say.every((s: unknown) => typeof s === "string" && s.length <= 400))),
    )
  );
}

export type SaveTranscriptResponse = { ok: true; count: number; retentionDays: number } | { ok: false; error: string };

/** Най-много толкова реда в едно запазване (около 8 часа разговор). */
export const MAX_SAVED_LINES = 5_000;

export type CalendarBusyResponse =
  | { ok: true; busy: { start: number; end: number }[] }
  | { ok: false; error: "not-configured" | "not-connected" | "failed" };

/** Календарът се пита най-много за една седмица наведнъж. */
const MAX_CALENDAR_RANGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Към offscreen документа. */
export type OffscreenMessage =
  /** withVideo: искаме и картината (като официалния пример на Chrome), когато само звук не тръгва. */
  /** meaning: модел за разбиране по смисъл; без него – изключено. */
  | { type: "offscreen-start"; streamId: string; stt: SttChoice; withVideo?: boolean; cloud?: CloudStt; meaning?: MeaningModelId }
  | { type: "offscreen-stop" }
  /** От панела: изречение на клиента без съвпадение по фраза → тема по смисъл (или null). */
  | { type: "meaning-match"; text: string }
  | { type: "offscreen-logs" };

/** Проблемът с микрофона идва с отговора: отделно съобщение пристига, преди сесията да е записана, и се губи. */
export type MicProblem = { code: CaptureErrorCode; detail: string };
export type OffscreenResponse = { ok: true; mic?: MicProblem; logs?: string[]; match?: MeaningMatch | null } | { ok: false; error: string };

export type LogsResponse = { lines: string[] };

const AUDIO_SOURCES: ReadonlySet<unknown> = new Set<AudioSourceKind>(["tab", "microphone"]);
const SPEAKERS: ReadonlySet<unknown> = new Set<SpeakerRole>(["owner", "counterpart"]);
const ERROR_CODES: ReadonlySet<unknown> = new Set<CaptureErrorCode>([
  "mic-permission-denied",
  "mic-unavailable",
  "tab-capture-failed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLatency(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isSegmentText(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_SEGMENT_LENGTH;
}

function isLevel(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

function isTranscriptLines(value: unknown): value is TranscriptLine[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_SAVED_LINES &&
    value.every(
      (line: unknown) => isRecord(line) && SPEAKERS.has(line.speaker) && isSegmentText(line.text) && Number.isFinite(line.at) && isLineCards(line.cards),
    )
  );
}

export function isContentMessage(value: unknown): value is ContentMessage {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "session-state":
      return typeof value.active === "boolean";
    case "audio-level":
      return AUDIO_SOURCES.has(value.source) && isLevel(value.level);
    case "capture-notice":
      return (value.tone === "info" || value.tone === "error") && typeof value.text === "string";
    case "mic-problem":
      return typeof value.text === "string";
    case "transcript-segment":
      return (
        SPEAKERS.has(value.speaker) &&
        isSegmentText(value.text) &&
        (value.latencyMs === undefined || isLatency(value.latencyMs))
      );
    default:
      return false;
  }
}

export function isBackgroundMessage(value: unknown): value is BackgroundMessage {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "panel-closed":
      return true;
    case "offscreen-level":
      return AUDIO_SOURCES.has(value.source) && isLevel(value.level);
    case "offscreen-error":
      return ERROR_CODES.has(value.code) && typeof value.detail === "string";
    case "offscreen-transcript":
      return SPEAKERS.has(value.speaker) && isSegmentText(value.text) && (value.latencyMs === null || isLatency(value.latencyMs));
    case "offscreen-status":
      return (value.tone === "info" || value.tone === "error") && typeof value.text === "string";
    case "logs-request":
      return true;
    case "save-transcript":
      return (
        typeof value.meetingCode === "string" &&
        value.meetingCode.length > 0 &&
        value.meetingCode.length <= 64 &&
        Number.isFinite(value.startedAt) &&
        isTranscriptLines(value.lines)
      );
    case "save-report":
      return isMeetingReport(value.report) && isTranscriptLines(value.lines);
    case "ai-suggest":
      return (
        typeof value.question === "string" &&
        value.question.trim().length >= 3 &&
        value.question.length <= AI_MAX_TEXT &&
        Array.isArray(value.turns) &&
        value.turns.length <= AI_MAX_TURNS &&
        value.turns.every(
          (t: unknown) => isRecord(t) && (t.speaker === "client" || t.speaker === "seller") && typeof t.text === "string" && t.text.length <= AI_MAX_TEXT,
        )
      );
    case "calendar-busy":
      return (
        Number.isFinite(value.start) &&
        Number.isFinite(value.end) &&
        (value.end as number) > (value.start as number) &&
        (value.end as number) - (value.start as number) <= MAX_CALENDAR_RANGE_MS
      );
    default:
      return false;
  }
}

export function isOffscreenMessage(value: unknown): value is OffscreenMessage {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "offscreen-start":
      return (
        typeof value.streamId === "string" &&
        value.streamId.length > 0 &&
        isSttChoice(value.stt) &&
        (value.withVideo === undefined || typeof value.withVideo === "boolean") &&
        (value.cloud === undefined || isCloudStt(value.cloud)) &&
        (value.meaning === undefined || (typeof value.meaning === "string" && Object.hasOwn(MEANING_MODELS, value.meaning)))
      );
    case "meaning-match":
      return isSegmentText(value.text) && (value.text as string).length > 0;
    case "offscreen-stop":
    case "offscreen-logs":
      return true;
    default:
      return false;
  }
}
