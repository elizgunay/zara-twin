import type { AudioSourceKind, SpeakerRole } from "@zara-twin/core";
import { isSttChoice, type SttChoice } from "../stt/choices";

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
  | { type: "logs-request" };

export type CalendarBusyResponse =
  | { ok: true; busy: { start: number; end: number }[] }
  | { ok: false; error: "not-configured" | "not-connected" | "failed" };

/** Календарът се пита най-много за една седмица наведнъж. */
const MAX_CALENDAR_RANGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Към offscreen документа. */
export type OffscreenMessage =
  /** withVideo: искаме и картината (като официалния пример на Chrome), когато само звук не тръгва. */
  | { type: "offscreen-start"; streamId: string; stt: SttChoice; withVideo?: boolean }
  | { type: "offscreen-stop" }
  | { type: "offscreen-logs" };

/** Проблемът с микрофона идва с отговора: отделно съобщение пристига, преди сесията да е записана, и се губи. */
export type MicProblem = { code: CaptureErrorCode; detail: string };
export type OffscreenResponse = { ok: true; mic?: MicProblem; logs?: string[] } | { ok: false; error: string };

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
        (value.withVideo === undefined || typeof value.withVideo === "boolean")
      );
    case "offscreen-stop":
    case "offscreen-logs":
      return true;
    default:
      return false;
  }
}
