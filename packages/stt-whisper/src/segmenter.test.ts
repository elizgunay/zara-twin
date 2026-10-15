import { describe, expect, it } from "vitest";
import { UtteranceSegmenter, type Utterance } from "./segmenter";

const RATE = 16_000;
const FRAME = 1600; // 100 ms
const speech = () => new Int16Array(FRAME).fill(3000); // RMS ≈ 0.09
const silence = () => new Int16Array(FRAME);

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
