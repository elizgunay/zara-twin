import { TARGET_SAMPLE_RATE, type AudioChunk, type AudioSourceKind, type SpeakerRole, type SttStream } from "@zara-twin/core";
import { BacklogError, serialTranscriber, WhisperLocalProvider, type Transcriber } from "@zara-twin/stt-whisper";
import { createTransformersTranscriber } from "@zara-twin/stt-whisper/transformers";
import { resolveAuto, STT_CHOICES, type SttChoice, type SttChoiceKey } from "../stt/choices";
import { configureRuntime, detectGpu } from "../stt/runtime";

/**
 * Разпознаване на говор по време на срещата, изцяло в браузъра (Р26).
 * Един модел за двата потока: микрофонът е ръководителят, табът е клиентът.
 * Звукът продължава да се прихваща, докато моделът се зарежда; текстът започва, щом е готов.
 */
export interface TranscriptionEvents {
  onText(speaker: SpeakerRole, text: string, latencyMs: number | null): void;
  onStatus(tone: "info" | "error", text: string): void;
}

const SPEAKER: Record<AudioSourceKind, SpeakerRole> = { tab: "counterpart", microphone: "owner" };
/** Колко рядко да напомняме, че компютърът изостава. */
const BACKLOG_NOTICE_MS = 30_000;

export class Transcription {
  private readonly streams = new Map<AudioSourceKind, SttStream>();
  private stopped = false;
  private dropped = 0;
  private lastBacklogNotice = 0;

  constructor(private readonly events: TranscriptionEvents) {}

  async start(choice: SttChoice, sources: AudioSourceKind[]): Promise<void> {
    const key = choice === "auto" ? resolveAuto(await detectGpu()) : choice;
    const model = await this.load(key);
    if (model === null || this.stopped) return;

    // Опашката с лимит: при бавен компютър пропускаме изречения, вместо да изоставаме с минути.
    const provider = new WhisperLocalProvider(serialTranscriber(model, 3));
    for (const source of sources) {
      const stream = await provider.openStream({
        speaker: SPEAKER[source],
        sampleRate: TARGET_SAMPLE_RATE,
        onSegment: (segment) => {
          if (this.stopped) return;
          const latency = segment.speechEndedAt === undefined ? null : segment.receivedAt - segment.speechEndedAt;
          this.events.onText(segment.speaker, segment.text, latency);
        },
        onError: (error) => this.handleError(error),
      });
      this.streams.set(source, stream);
    }
    this.events.onStatus("info", "Разпознаването на говор е включено.");
  }

  write(chunk: AudioChunk): void {
    if (!this.stopped) this.streams.get(chunk.source)?.write(chunk);
  }

  /** Без изчакване на опашката: при стоп текстът вече не е нужен. */
  stop(): void {
    this.stopped = true;
    this.streams.clear();
  }

  private async load(key: SttChoiceKey): Promise<Transcriber | null> {
    const { label, options } = STT_CHOICES[key];
    configureRuntime();
    this.events.onStatus("info", `Зареждане на разпознаването на говор (${label})…`);
    try {
      const model = await createTransformersTranscriber(options);
      await model.transcribe(new Float32Array(TARGET_SAMPLE_RATE)); // първото пускане е по-бавно
      return model;
    } catch (error) {
      if (this.stopped) return null;
      // Видеокартата не тръгна (драйвер, памет): опитваме с процесора, вместо да спрем изцяло.
      if (key !== "cpu-small") {
        this.events.onStatus("error", "Видеокартата не тръгна. Опит с процесора…");
        return this.load("cpu-small");
      }
      this.events.onStatus("error", `Разпознаването на говор не тръгна: ${message(error)}`);
      return null;
    }
  }

  private handleError(error: Error): void {
    if (this.stopped) return;
    if (error instanceof BacklogError) {
      this.dropped++;
      const now = Date.now();
      if (now - this.lastBacklogNotice >= BACKLOG_NOTICE_MS) {
        this.lastBacklogNotice = now;
        this.events.onStatus("error", `Компютърът изостава: пропуснати изречения ${this.dropped}.`);
      }
      return;
    }
    this.events.onStatus("error", `Грешка при разпознаване: ${message(error)}`);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
