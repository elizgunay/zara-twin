import type { AudioChunk } from "./meeting";
import type { SpeakerRole, TranscriptSegment } from "./transcript";

/**
 * Общ интерфейс за разпознаване на говор. Във Фаза 1.0 зад него стоят
 * кандидатите за сравнение (Google, Azure, локален Whisper), а ядрото
 * не зависи от това кой е избран.
 */
export interface SpeechToTextProvider {
  /** Напр. "google-stt", "azure-speech", "whisper-local". */
  readonly id: string;
  /** Регионът на обработка. Проверява се с assertEuRegion (Р22). */
  readonly region: string;
  readonly language: "bg-BG";
  openStream(options: SttStreamOptions): Promise<SttStream>;
}

export type SttSegment = Omit<TranscriptSegment, "id" | "meetingId">;

export interface SttStreamOptions {
  /** Един поток = един източник на звук, затова говорещият е известен предварително. */
  speaker: SpeakerRole;
  sampleRate: number;
  onSegment: (segment: SttSegment) => void;
  onError: (error: Error) => void;
}

export interface SttStream {
  write(chunk: AudioChunk): void;
  close(): Promise<void>;
}
