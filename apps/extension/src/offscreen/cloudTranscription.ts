import { assertEuRegion, AutoGain, TARGET_SAMPLE_RATE, type AudioChunk, type AudioSourceKind, type SpeakerRole } from "@zara-twin/core";
import { pack } from "../pack";
import { log, throttledCounter } from "../shared/log";
import {
  SPEECHMATICS_REALTIME_URL,
  SPEECHMATICS_REGION,
  SPEECHMATICS_TEMP_KEY_URL,
  type CloudStt,
} from "../stt/cloud";
import type { TranscriptionEvents } from "./transcription";

const SPEAKER: Record<AudioSourceKind, SpeakerRole> = { tab: "counterpart", microphone: "owner" };
/** Временният ключ трябва само за свързването; кратък срок = по-малък риск. */
const TEMP_KEY_TTL_SECONDS = 120;
/** Облакът връща текста на парчета (дума или две). Без нов текст толкова време = край на изречението. */
const SENTENCE_IDLE_MS = 900;

interface Session {
  socket: WebSocket;
  ready: boolean;
  /** Кога е тръгнал звукът към сървъра: от него се смятат времената в отговорите. */
  startedAt: number;
  sent: number;
  /** Събраното изречение, докато не завърши с точка или пауза. */
  sentence: string;
  /** Краят на последната дума в звука (секунди от началото): за закъснението. */
  sentenceEnd: number;
  flushTimer: ReturnType<typeof setTimeout> | undefined;
  /** Тих микрофон се усилва, иначе облакът го приема за шум. */
  gain: AutoGain;
}

interface RealtimeMessage {
  message: string;
  reason?: string;
  type?: string;
  metadata?: { transcript: string; end_time: number };
}

/**
 * Разпознаване на живо в облака (Speechmatics, ЕС). Същият интерфейс като WorkerTranscription:
 * по една връзка за всеки източник (микрофон = ръководителят, таб = клиентът).
 */
export class CloudTranscription {
  private readonly sessions = new Map<AudioSourceKind, Session>();
  /** Диагностика: изпратени парчета звук, потвърдени от сървъра (AudioAdded) и върнат текст. */
  private readonly traffic = throttledCounter("облак: трафик");
  private stopped = false;

  constructor(
    private readonly events: TranscriptionEvents,
    private readonly cloud: CloudStt,
  ) {}

  start(sources: AudioSourceKind[]): void {
    assertEuRegion("speechmatics", SPEECHMATICS_REGION);
    this.events.onStatus("info", "Свързване с облачното разпознаване (Speechmatics, ЕС)…");
    void Promise.all(sources.map((source) => this.open(source))).then(
      () => {
        if (!this.stopped) this.events.onStatus("info", "Разпознаването на говор е включено (облак, ЕС).");
      },
      (error: unknown) => {
        log("облак", "свързването се провали", error);
        if (!this.stopped) this.events.onStatus("error", `Облачното разпознаване не тръгна: ${describe(error)}`);
      },
    );
  }

  write(chunk: AudioChunk): void {
    const session = this.sessions.get(chunk.source);
    if (this.stopped || !session?.ready || session.socket.readyState !== WebSocket.OPEN) return;
    if (session.startedAt === 0) session.startedAt = Date.now() - (chunk.pcm.length / TARGET_SAMPLE_RATE) * 1000;
    session.socket.send(session.gain.process(chunk.pcm).buffer);
    session.sent++;
    this.traffic(`изпратени-${chunk.source}`, () => ({ усилване: session.gain.gain.toFixed(1) }));
  }

  stop(): void {
    this.stopped = true;
    for (const session of this.sessions.values()) {
      clearTimeout(session.flushTimer);
      if (session.socket.readyState === WebSocket.OPEN) {
        session.socket.send(JSON.stringify({ message: "EndOfStream", last_seq_no: session.sent }));
      }
      session.socket.close();
    }
    this.sessions.clear();
  }

  private async open(source: AudioSourceKind): Promise<void> {
    const jwt = await this.temporaryKey();
    if (this.stopped) return;
    const socket = new WebSocket(`${SPEECHMATICS_REALTIME_URL}?jwt=${encodeURIComponent(jwt)}`);
    const session: Session = { socket, ready: false, startedAt: 0, sent: 0, sentence: "", sentenceEnd: 0, flushTimer: undefined, gain: new AutoGain() };
    this.sessions.set(source, session);

    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            message: "StartRecognition",
            audio_format: { type: "raw", encoding: "pcm_s16le", sample_rate: TARGET_SAMPLE_RATE },
            transcription_config: {
              language: "bg",
              operating_point: "enhanced",
              max_delay: 1,
              additional_vocab: vocabulary(),
            },
          }),
        );
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        const message = JSON.parse(event.data) as RealtimeMessage;
        if (message.message === "RecognitionStarted") {
          session.ready = true;
          log("облак", "връзката е готова за", source);
          resolve();
        } else if (message.message === "AudioAdded") {
          this.traffic(`приети-${source}`);
        } else if (message.message === "AddTranscript") {
          this.traffic(`текст-${source}`);
          const piece = message.metadata?.transcript.replace(/\s+/g, " ").trim() ?? "";
          if (!piece || this.stopped) return;
          this.collect(source, session, piece, message.metadata?.end_time ?? 0);
        } else if (message.message === "Error") {
          log("облак", "грешка от сървъра", source, message.type, message.reason);
          const error =
            message.type === "quota_exceeded"
              ? // Безплатният акаунт: 2 едновременни връзки (вие + събеседникът). Връзки от
                // презаредено или премахнато разширение сървърът държи още няколко минути.
                new Error("облакът е зает (лимит 2 връзки, старите още не са затворени). Изчакайте 2–3 минути и включете Copilot отново")
              : new Error(`${message.type ?? "Error"}: ${message.reason ?? ""}`);
          if (!session.ready) reject(error);
          else if (!this.stopped) this.events.onStatus("error", `Облачното разпознаване спря: ${error.message}`);
        } else if (message.message === "Warning" || message.message === "Info") {
          log("облак", message.message, source, message.type, message.reason);
        }
      };
      socket.onerror = () => reject(new Error("Няма връзка със сървъра на Speechmatics."));
      socket.onclose = (event) => {
        log("облак", "връзката е затворена", source, event.code, event.reason);
        if (!session.ready) reject(new Error(`Връзката се затвори (${event.code} ${event.reason})`));
        else if (!this.stopped) this.events.onStatus("error", "Връзката с облачното разпознаване прекъсна.");
      };
    });
  }

  /** Добавя парче към изречението; изпраща го при точка, въпрос или удивителна, иначе след пауза. */
  private collect(source: AudioSourceKind, session: Session, piece: string, endTime: number): void {
    clearTimeout(session.flushTimer);
    // Препинателните знаци идват отделно („.“, „, а“): лепим ги без интервал.
    session.sentence = /^[,.!?;:]/.test(piece) ? `${session.sentence}${piece}` : `${session.sentence} ${piece}`.trim();
    session.sentenceEnd = Math.max(session.sentenceEnd, endTime);
    if (/[.!?]$/.test(session.sentence)) this.flush(source, session);
    else session.flushTimer = setTimeout(() => this.flush(source, session), SENTENCE_IDLE_MS);
  }

  private flush(source: AudioSourceKind, session: Session): void {
    clearTimeout(session.flushTimer);
    const text = session.sentence.trim();
    session.sentence = "";
    if (!text || /^[,.!?;:]+$/.test(text) || this.stopped) return;
    const spokenAt = session.startedAt + session.sentenceEnd * 1000;
    log("облак", "изречение от", source, `${text.length} знака`);
    this.events.onText(SPEAKER[source], text, session.startedAt ? Math.max(0, Date.now() - spokenAt) : null);
  }

  /** Временен ключ за WebSocket (браузърът не може да прати заглавка Authorization). */
  private async temporaryKey(): Promise<string> {
    const response = await fetch(SPEECHMATICS_TEMP_KEY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.cloud.apiKey}` },
      body: JSON.stringify({ ttl: TEMP_KEY_TTL_SECONDS }),
    });
    if (response.status === 401 || response.status === 403) throw new Error("ключът не е приет (проверете го в настройките)");
    if (!response.ok) throw new Error(`временен ключ: HTTP ${response.status}`);
    const { key_value: key } = (await response.json()) as { key_value?: string };
    if (!key) throw new Error("временен ключ: празен отговор");
    return key;
  }
}

/** Имената от пакета със знания (фирма, серии, модели), за да не се изкривяват. */
function vocabulary(): { content: string }[] {
  const words = new Set<string>([pack.business.name]);
  for (const family of pack.families) words.add(family.name);
  for (const product of pack.products) {
    words.add(product.name);
    if (product.code) words.add(product.code);
  }
  return [...words].filter((word) => word.length >= 2 && word.length <= 64).slice(0, 500).map((content) => ({ content }));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
