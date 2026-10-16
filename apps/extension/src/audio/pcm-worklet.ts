// Изпълнява се в AudioWorkletGlobalScope (отделна нишка за звук).
// Смесва каналите в моно и праща парчета от 100 ms към offscreen документа,
// вместо по 128 семпла (≈ 375 съобщения в секунда).

declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

/** 100 ms звук. Отделна константа: след прехвърлянето chunk.length вече е 0. */
const CHUNK_FRAMES = Math.round(sampleRate / 10);

class PcmCollector extends AudioWorkletProcessor {
  private buffer = new Float32Array(CHUNK_FRAMES);
  private filled = 0;

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    const frames = channels?.[0]?.length ?? 0;
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (const channel of channels!) sum += channel[i]!;
      this.buffer[this.filled++] = sum / channels!.length;
      if (this.filled === this.buffer.length) {
        const chunk = this.buffer;
        // Прехвърляне без копие: след него chunk е празен (дължина 0), затова новият
        // буфер е с CHUNK_FRAMES. С chunk.length тук звукът спираше след първите 100 ms.
        this.port.postMessage(chunk, [chunk.buffer]);
        this.buffer = new Float32Array(CHUNK_FRAMES);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-collector", PcmCollector);

export {};
