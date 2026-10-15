// Изпълнява се в AudioWorkletGlobalScope (отделна нишка за звук).
// Смесва каналите в моно и праща парчета от 100 ms към offscreen документа,
// вместо по 128 семпла (≈ 375 съобщения в секунда).

declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class PcmCollector extends AudioWorkletProcessor {
  private buffer = new Float32Array(Math.round(sampleRate / 10));
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
        this.port.postMessage(chunk, [chunk.buffer]);
        this.buffer = new Float32Array(chunk.length);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-collector", PcmCollector);

export {};
