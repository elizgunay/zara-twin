import {
  assertEuRegion,
  int16ToFloat32,
  TARGET_SAMPLE_RATE,
  type SpeechToTextProvider,
  type SttStream,
  type SttStreamOptions,
} from "@zara-twin/core";
import { isLikelyHallucination } from "./hallucinations";
import { UtteranceSegmenter, type SegmenterOptions } from "./segmenter";

/** Самият модел. Отделен е, за да се тества доставчикът без 250 MB модел. */
export interface Transcriber {
  readonly id: string;
  transcribe(audio: Float32Array): Promise<string>;
}

export type WhisperProviderOptions = Omit<SegmenterOptions, "sampleRate">;

/**
 * Локален Whisper: звукът не напуска компютъра, затова регионът е „local“ (Р22).
 * Изказванията се разпознават едно по едно. Ако компютърът е по-бавен от говора,
 * опашката расте и закъснението се трупа. Точно това мери инструментът stt-bench.
 */
export class WhisperLocalProvider implements SpeechToTextProvider {
  readonly id: string;
  readonly region = "local";
  readonly language = "bg-BG" as const;

  constructor(
    private readonly transcriber: Transcriber,
    private readonly options: WhisperProviderOptions = {},
  ) {
    this.id = `whisper-local:${transcriber.id}`;
  }

  async openStream(stream: SttStreamOptions): Promise<SttStream> {
    assertEuRegion(this.id, this.region);
    if (stream.sampleRate !== TARGET_SAMPLE_RATE) {
      throw new Error(`Whisper очаква ${TARGET_SAMPLE_RATE} Hz, а получава ${stream.sampleRate} Hz.`);
    }

    const segmenter = new UtteranceSegmenter({ ...this.options, sampleRate: stream.sampleRate });
    let queue: Promise<void> = Promise.resolve();
    let closed = false;

    const enqueue = (pcm: Int16Array, startMs: number, endMs: number, speechEndedAt: number) => {
      queue = queue.then(async () => {
        try {
          const text = (await this.transcriber.transcribe(int16ToFloat32(pcm))).trim();
          if (isLikelyHallucination(text)) return;
          stream.onSegment({
            speaker: stream.speaker,
            text,
            startMs,
            endMs,
            isFinal: true,
            providerId: this.id,
            receivedAt: Date.now(),
            speechEndedAt,
          });
        } catch (error) {
          stream.onError(error instanceof Error ? error : new Error(String(error)));
        }
      });
    };

    return {
      write: (chunk) => {
        if (closed) return;
        for (const u of segmenter.push(chunk.pcm)) {
          enqueue(u.pcm, u.startMs, u.endMs, chunk.capturedAt - u.trailingSilenceMs);
        }
      },
      close: async () => {
        if (closed) return;
        closed = true;
        for (const u of segmenter.flush()) enqueue(u.pcm, u.startMs, u.endMs, Date.now());
        await queue;
      },
    };
  }
}
