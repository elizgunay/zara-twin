import type { AudioChunk, AudioSourceKind } from "@zara-twin/core";
import type { SttChoice } from "../stt/choices";
import type { TranscriptionEvents } from "./transcription";
import type { FromWorker, ToWorker } from "./workerProtocol";

/** Същият интерфейс като Transcription, но разпознаването тече в отделна нишка. */
export class WorkerTranscription {
  private readonly worker = new Worker(new URL("stt-worker.js", location.href), { type: "module" });

  constructor(events: TranscriptionEvents) {
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      if (message.type === "text") events.onText(message.speaker, message.text, message.latencyMs);
      else events.onStatus(message.tone, message.text);
    };
    this.worker.onerror = (event) => {
      events.onStatus("error", `Разпознаването на говор спря: ${event.message || "неизвестна грешка"}`);
    };
  }

  start(choice: SttChoice, sources: AudioSourceKind[]): void {
    this.post({ type: "start", choice, sources });
  }

  write(chunk: AudioChunk): void {
    // Прехвърляме буфера, вместо да го копираме: 10 парчета в секунда на източник.
    // Ако парчето е изглед върху по-голям буфер, прехвърлянето би изпразнило и останалото,
    // затова тогава правим собствено копие.
    const pcm = ownsBuffer(chunk.pcm) ? chunk.pcm : chunk.pcm.slice();
    this.worker.postMessage({ type: "chunk", chunk: { ...chunk, pcm } } satisfies ToWorker, [pcm.buffer]);
  }

  stop(): void {
    this.post({ type: "stop" });
    this.worker.terminate();
  }

  private post(message: ToWorker): void {
    this.worker.postMessage(message);
  }
}

export function ownsBuffer(view: ArrayBufferView): boolean {
  return view.byteOffset === 0 && view.byteLength === view.buffer.byteLength;
}
