import { rmsLevel, TARGET_SAMPLE_RATE, type AudioChunk, type AudioSourceKind, type SpeakerRole, type SttStream } from "@zara-twin/core";
import {
  BacklogError,
  DEFAULT_SEGMENTER,
  serialTranscriber,
  WhisperLocalProvider,
  type Transcriber,
} from "@zara-twin/stt-whisper";
import { createTransformersTranscriber } from "@zara-twin/stt-whisper/transformers";
import { resolveAuto, STT_CHOICES, type SttChoice, type SttChoiceKey } from "../stt/choices";
import { log } from "../shared/log";
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
/** Диагностика за пилота: колко изказвания е чул моделът и какво е върнал. */
const DIAGNOSTICS_MS = 3_000;
/** Колко рядко да напомняме, че компютърът изостава. */
const BACKLOG_NOTICE_MS = 30_000;

export class Transcription {
  private readonly streams = new Map<AudioSourceKind, SttStream>();
  private stopped = false;
  private dropped = 0;
  private lastBacklogNotice = 0;
  private cut = 0;
  private heard = 0;
  private pending = 0;
  private peak: Record<AudioSourceKind, number> = { tab: 0, microphone: 0 };
  private ready = false;
  private empty = 0;
  private lastText = "";
  private lastDiagnostics = 0;

  constructor(private readonly events: TranscriptionEvents) {}

  async start(choice: SttChoice, sources: AudioSourceKind[]): Promise<void> {
    const gpu = await detectGpu();
    const key = choice === "auto" ? resolveAuto(gpu) : choice;
    log("разпознаване", "избор", { choice, key, gpu });
    const model = await this.load(key);
    if (model === null || this.stopped) return;

    // Опашката с лимит: при бавен компютър пропускаме изречения, вместо да изоставаме с минути.
    const provider = new WhisperLocalProvider(serialTranscriber(this.counted(model), 3), {
      onUtterance: (ms) => {
        this.cut++;
        log("разпознаване", "изрязано изказване", ms, "ms; чакат модела:", this.pending);
      },
    });
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
      log("разпознаване", "поток отворен за", source);
    }
    this.events.onStatus("info", "Разпознаването на говор е включено.");
    this.ready = true;
  }

  write(chunk: AudioChunk): void {
    if (this.stopped) return;
    this.peak[chunk.source] = Math.max(this.peak[chunk.source], rmsLevel(chunk.pcm));
    this.streams.get(chunk.source)?.write(chunk);
    this.reportDiagnostics();
  }

  /**
   * Диагностика за пилота: най-силният звук за последните секунди спрямо прага за говор,
   * колко изказвания са изрязани, колко чакат модела и какво е върнал.
   */
  private reportDiagnostics(): void {
    const now = Date.now();
    if (!this.ready || now - this.lastDiagnostics < DIAGNOSTICS_MS) return;
    this.lastDiagnostics = now;
    const level = (value: number) => value.toFixed(3).replace(".", ",");
    const last = this.lastText ? ` Последно: „${this.lastText}“` : "";
    this.events.onStatus(
      "info",
      `Вие ${level(this.peak.microphone)}, събеседник ${level(this.peak.tab)} ` +
        `(говор над ${level(DEFAULT_SEGMENTER.minSpeechThreshold)}). ` +
        `Изказвания: ${this.cut}, чакат: ${this.pending}, разпознати: ${this.heard}, без текст: ${this.empty}.${last}`,
    );
    this.peak = { tab: 0, microphone: 0 };
  }

  /** Без изчакване на опашката: при стоп текстът вече не е нужен. */
  stop(): void {
    this.stopped = true;
    this.streams.clear();
  }

  /** Брои изказванията и празните резултати, за да се вижда къде се губи текстът. */
  private counted(model: Transcriber): Transcriber {
    return {
      id: model.id,
      transcribe: async (pcm) => {
        this.pending++;
        const began = performance.now();
        log("разпознаване", "моделът започва", (pcm.length / TARGET_SAMPLE_RATE).toFixed(1), "s звук");
        try {
          const text = await model.transcribe(pcm);
          log("разпознаване", "моделът върна за", Math.round(performance.now() - began), "ms:", JSON.stringify(text.trim().slice(0, 40)));
          this.heard++;
          if (text.trim() === "") this.empty++;
          else this.lastText = text.trim().slice(0, 60);
          return text;
        } catch (error) {
          log("разпознаване", "моделът даде грешка", error);
          throw error;
        } finally {
          this.pending--;
        }
      },
    };
  }

  private async load(key: SttChoiceKey): Promise<Transcriber | null> {
    const { label, options } = STT_CHOICES[key];
    configureRuntime();
    this.events.onStatus("info", `Зареждане на разпознаването на говор (${label})…`);
    log("разпознаване", "зареждане", key, options);
    const began = performance.now();
    try {
      const model = await createTransformersTranscriber(options);
      await model.transcribe(new Float32Array(TARGET_SAMPLE_RATE)); // първото пускане е по-бавно
      log("разпознаване", "моделът е готов за", Math.round(performance.now() - began), "ms");
      return model;
    } catch (error) {
      log("разпознаване", "зареждането се провали", key, error);
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
    log("разпознаване", "грешка", error.name, error.message);
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
