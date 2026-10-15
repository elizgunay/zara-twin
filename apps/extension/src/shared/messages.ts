import type { AudioSourceKind } from "@zara-twin/core";

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
  | { type: "capture-notice"; tone: "info" | "error"; text: string };

/** Към service worker-а. */
export type BackgroundMessage =
  | { type: "panel-closed" }
  | { type: "offscreen-level"; source: AudioSourceKind; level: number }
  | { type: "offscreen-error"; code: CaptureErrorCode; detail: string };

/** Към offscreen документа. */
export type OffscreenMessage =
  | { type: "offscreen-start"; streamId: string }
  | { type: "offscreen-stop" };

export type OffscreenResponse = { ok: true } | { ok: false; error: string };

const AUDIO_SOURCES: ReadonlySet<unknown> = new Set<AudioSourceKind>(["tab", "microphone"]);
const ERROR_CODES: ReadonlySet<unknown> = new Set<CaptureErrorCode>([
  "mic-permission-denied",
  "mic-unavailable",
  "tab-capture-failed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
    default:
      return false;
  }
}

export function isOffscreenMessage(value: unknown): value is OffscreenMessage {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "offscreen-start":
      return typeof value.streamId === "string" && value.streamId.length > 0;
    case "offscreen-stop":
      return true;
    default:
      return false;
  }
}
