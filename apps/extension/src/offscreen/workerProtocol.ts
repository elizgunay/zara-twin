import type { AudioChunk, AudioSourceKind, SpeakerRole } from "@zara-twin/core";
import type { SttChoice } from "../stt/choices";

/** Съобщения между offscreen документа и worker-а с разпознаването. */
export type ToWorker =
  | { type: "start"; choice: SttChoice; sources: AudioSourceKind[] }
  | { type: "chunk"; chunk: AudioChunk }
  | { type: "stop" };

export type FromWorker =
  | { type: "text"; speaker: SpeakerRole; text: string; latencyMs: number | null }
  | { type: "status"; tone: "info" | "error"; text: string };
