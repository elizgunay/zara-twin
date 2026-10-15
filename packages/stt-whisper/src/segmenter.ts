import { rmsLevel } from "@zara-twin/core";

/**
 * Whisper не работи като поток: получава цяло изказване и връща текста му.
 * Затова режем звука на изказвания по паузите (прост VAD по сила на звука).
 *
 * Закъснението на живо ≈ endSilenceMs (чакаме паузата) + времето за разпознаване.
 * По-къса пауза = по-бърз текст, но по-често рязане по средата на изречение.
 */
export interface SegmenterOptions {
  sampleRate: number;
  /** RMS над този праг се смята за говор. */
  speechThreshold?: number;
  /** По-кратки звуци (почукване, кашлица) се пропускат. */
  minSpeechMs?: number;
  /** Толкова тишина приключва изказването. */
  endSilenceMs?: number;
  /** Дълъг монолог се реже принудително, за да не чака текстът твърде дълго. */
  maxUtteranceMs?: number;
  /** Звук преди началото на говора, за да не се изяжда първата сричка. */
  preRollMs?: number;
}

export interface Utterance {
  pcm: Int16Array;
  /** Милисекунди от началото на потока. */
  startMs: number;
  /** Краят на говора (без тишината след него). */
  endMs: number;
  /** Колко тишина е изчакана след говора, преди изказването да приключи. */
  trailingSilenceMs: number;
}

export const DEFAULT_SEGMENTER = {
  speechThreshold: 0.012,
  minSpeechMs: 250,
  endSilenceMs: 600,
  maxUtteranceMs: 12_000,
  preRollMs: 300,
} as const;

export class UtteranceSegmenter {
  private readonly sampleRate: number;
  private readonly threshold: number;
  private readonly minSpeech: number;
  private readonly endSilence: number;
  private readonly maxUtterance: number;
  private readonly preRollLimit: number;

  private samplesSeen = 0;
  private preRoll: Int16Array[] = [];
  private current: Int16Array[] | null = null;
  private currentStart = 0;
  private currentLength = 0;
  private speechSamples = 0;
  private trailingSilence = 0;

  constructor(options: SegmenterOptions) {
    const ms = (value: number) => Math.round((value / 1000) * options.sampleRate);
    this.sampleRate = options.sampleRate;
    this.threshold = options.speechThreshold ?? DEFAULT_SEGMENTER.speechThreshold;
    this.minSpeech = ms(options.minSpeechMs ?? DEFAULT_SEGMENTER.minSpeechMs);
    this.endSilence = ms(options.endSilenceMs ?? DEFAULT_SEGMENTER.endSilenceMs);
    this.maxUtterance = ms(options.maxUtteranceMs ?? DEFAULT_SEGMENTER.maxUtteranceMs);
    this.preRollLimit = ms(options.preRollMs ?? DEFAULT_SEGMENTER.preRollMs);
  }

  /** Подава следващото парче звук. Връща изказванията, които са приключили с него. */
  push(frame: Int16Array): Utterance[] {
    const done: Utterance[] = [];
    const isSpeech = rmsLevel(frame) >= this.threshold;

    if (this.current === null) {
      if (isSpeech) {
        const preRollLength = this.preRoll.reduce((sum, part) => sum + part.length, 0);
        this.current = [...this.preRoll, frame];
        this.currentStart = this.samplesSeen - preRollLength;
        this.currentLength = preRollLength + frame.length;
        this.speechSamples = frame.length;
        this.trailingSilence = 0;
        this.preRoll = [];
      } else {
        this.preRoll.push(frame);
        let length = this.preRoll.reduce((sum, part) => sum + part.length, 0);
        while (this.preRoll.length > 0 && length - this.preRoll[0]!.length >= this.preRollLimit) {
          length -= this.preRoll.shift()!.length;
        }
      }
    } else {
      this.current.push(frame);
      this.currentLength += frame.length;
      if (isSpeech) {
        this.speechSamples += frame.length;
        this.trailingSilence = 0;
      } else {
        this.trailingSilence += frame.length;
      }
    }

    this.samplesSeen += frame.length;

    if (
      this.current !== null &&
      (this.trailingSilence >= this.endSilence || this.currentLength >= this.maxUtterance)
    ) {
      const utterance = this.finish();
      if (utterance) done.push(utterance);
    }
    return done;
  }

  /** Приключва текущото изказване, напр. при край на срещата. */
  flush(): Utterance[] {
    const utterance = this.current === null ? null : this.finish();
    return utterance ? [utterance] : [];
  }

  private finish(): Utterance | null {
    const parts = this.current!;
    const speechSamples = this.speechSamples;
    const trailing = this.trailingSilence;
    const start = this.currentStart;
    const length = this.currentLength;
    this.current = null;
    this.currentLength = 0;
    this.speechSamples = 0;
    this.trailingSilence = 0;

    if (speechSamples < this.minSpeech) return null;

    const pcm = new Int16Array(length);
    let offset = 0;
    for (const part of parts) {
      pcm.set(part, offset);
      offset += part.length;
    }
    const toMs = (samples: number) => Math.round((samples / this.sampleRate) * 1000);
    return {
      pcm,
      startMs: toMs(start),
      endMs: toMs(start + length - trailing),
      trailingSilenceMs: toMs(trailing),
    };
  }
}
