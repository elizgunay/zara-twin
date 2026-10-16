import { describe, expect, it } from "vitest";
import { UtteranceSegmenter, type Utterance } from "./segmenter";

const RATE = 16_000;
const FRAME = 1600; // 100 ms
const speech = () => new Int16Array(FRAME).fill(3000); // RMS ≈ 0.09
const silence = () => new Int16Array(FRAME);
const level = (value: number) => () => new Int16Array(FRAME).fill(Math.round(value * 32768));

function feed(segmenter: UtteranceSegmenter, pattern: string): Utterance[] {
  // „s“ = 100 ms говор, „.“ = 100 ms тишина
  return [...pattern].flatMap((c) => segmenter.push(c === "s" ? speech() : silence()));
}

describe("UtteranceSegmenter", () => {
  it("не връща нищо при тишина", () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE });
    expect(feed(segmenter, "..........")).toEqual([]);
    expect(segmenter.flush()).toEqual([]);
  });

  it("приключва изказването след 600 ms тишина и включва 300 ms преди говора", () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE });
    const result = feed(segmenter, ".....ssssssssss......");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ startMs: 200, endMs: 1500, trailingSilenceMs: 600 });
    expect(result[0]!.pcm).toHaveLength((3 + 10 + 6) * FRAME);
  });

  it("пропуска кратки звуци (почукване)", () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE });
    expect(feed(segmenter, "..s.........")).toEqual([]);
  });

  it("реже дълъг монолог на 12 секунди", () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE });
    const result = feed(segmenter, "s".repeat(150));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ startMs: 0, endMs: 12_000, trailingSilenceMs: 0 });
  });

  it("flush връща започнато изказване", () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE });
    expect(feed(segmenter, "sssss..")).toEqual([]);
    expect(segmenter.flush()).toHaveLength(1);
  });

  it("чува тих микрофон, когато фонът е тих", () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE });
    const quiet = level(0.006); // под стария фиксиран праг 0,012
    const frames = [...Array(5).fill(silence), ...Array(10).fill(quiet), ...Array(7).fill(silence)];
    expect(frames.flatMap((make) => segmenter.push(make()))).toHaveLength(1);
  });

  it("не приема постоянен шум за говор", () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE });
    const hum = level(0.006);
    expect(Array.from({ length: 100 }, () => segmenter.push(hum())).flat()).toEqual([]);
  });

  it("без автоматика при minSpeechThreshold = speechThreshold", () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE, minSpeechThreshold: 0.012 });
    const frames = [...Array(5).fill(silence), ...Array(10).fill(level(0.006)), ...Array(7).fill(silence)];
    expect(frames.flatMap((make) => segmenter.push(make()))).toEqual([]);
  });

  it("разделя две изречения с пауза", () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE });
    const result = feed(segmenter, "sssss.......sssss.......");
    expect(result.map((u) => [u.startMs, u.endMs])).toEqual([
      [0, 500],
      // Вторият започва 100 ms по-рано (единствената тишина, останала след края на първия).
      [1100, 1700],
    ]);
  });
});
