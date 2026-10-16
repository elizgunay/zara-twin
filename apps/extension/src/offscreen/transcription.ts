import { decodeWav, downsampleToInt16, rmsLevel, TARGET_SAMPLE_RATE, type AudioChunk, type AudioSourceKind, type SpeakerRole, type SttStream } from "@zara-twin/core";
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
/**
 * Ако едно изказване се разпознава по-дълго от това, моделът се смята за блокирал.
 * Видяно на AMD Vega (gcn-5): видеокартата минава пробата с тишина, но зависва на говор.
 */
const STALL_MS = 30_000;
/** Колко рядко да напомняме, че компютърът изостава. */
const BACKLOG_NOTICE_MS = 30_000;

class StallError extends Error {
  override readonly name = "StallError";
}

export class Transcription {
  private readonly streams = new Map<AudioSourceKind, SttStream>();
  private sources: AudioSourceKind[] = [];
  private key: SttChoiceKey = "cpu-small";
  private switching = false;
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
    this.sources = sources;
    const model = await this.load(key);
    if (model === null || this.stopped) return;
    await this.open(model);
    this.events.onStatus("info", `Разпознаването на говор е включено (на компютъра: ${STT_CHOICES[this.key].label}).`);
    this.ready = true;
  }

  /** Отваря потоците за всички източници с дадения модел (и при смяна на модела). */
  private async open(model: Transcriber): Promise<void> {
    this.streams.clear();
    // Опашката с лимит: при бавен компютър пропускаме изречения, вместо да изоставаме с минути.
    const provider = new WhisperLocalProvider(serialTranscriber(this.counted(model), 3), {
      onUtterance: (ms) => {
        this.cut++;
        log("разпознаване", "изрязано изказване", ms, "ms; чакат модела:", this.pending);
      },
    });
    for (const source of this.sources) {
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
      log("разпознаване", "поток отворен за", source, "с", model.id);
    }
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
          const text = await withTimeout(model.transcribe(pcm), STALL_MS);
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
      // Пробата е с истински говор, не с тишина: тишината минава и там, където говорът зависва.
      const probe = await withTimeout(model.transcribe(await warmupAudio()), STALL_MS);
      log("разпознаване", "проба:", JSON.stringify(probe.trim().slice(0, 40)));
      this.key = key;
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
    if (error instanceof StallError) {
      void this.fallBackToCpu();
      return;
    }
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

  /** Видеокартата зависна по време на срещата: продължаваме с процесора (веднъж). */
  private async fallBackToCpu(): Promise<void> {
    if (this.switching || this.key === "cpu-small") return;
    this.switching = true;
    this.streams.clear();
    this.events.onStatus("error", "Видеокартата зависна при разпознаване. Превключвам на процесора (по-бавно)…");
    const model = await this.load("cpu-small");
    if (model !== null && !this.stopped) await this.open(model);
    if (model !== null) this.events.onStatus("info", "Разпознаването продължава на процесора.");
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StallError(`Моделът не отговори за ${ms / 1000} s.`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** 3 секунди от тестовия запис в разширението; без него: тишина. */
async function warmupAudio(): Promise<Float32Array> {
  try {
    const response = await fetch(new URL("selftest/sample.wav", self.location.href));
    const wav = decodeWav(new Uint8Array(await response.arrayBuffer()));
    const speech = downsampleToInt16(wav.samples.subarray(0, wav.sampleRate * 3), wav.sampleRate);
    return Float32Array.from(speech, (value) => value / 32768);
  } catch {
    return new Float32Array(TARGET_SAMPLE_RATE);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
