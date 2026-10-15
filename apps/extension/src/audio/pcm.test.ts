import { describe, expect, it } from "vitest";
import { downsampleToInt16, rmsLevel } from "./pcm";

describe("downsampleToInt16", () => {
  it("превръща 100 ms при 48 kHz и при 44.1 kHz в точно 1600 семпла при 16 kHz", () => {
    expect(downsampleToInt16(new Float32Array(4800), 48_000)).toHaveLength(1600);
    expect(downsampleToInt16(new Float32Array(4410), 44_100)).toHaveLength(1600);
  });

  it("осреднява съседните семпли", () => {
    const output = downsampleToInt16(new Float32Array([0.2, 0.4, 0.6, -0.2, -0.4, -0.6]), 48_000);
    expect(Array.from(output)).toEqual([Math.round(0.4 * 0x7fff), Math.round(-0.4 * 0x8000)]);
  });

  it("срязва стойностите извън [-1, 1]", () => {
    const output = downsampleToInt16(new Float32Array([2, 2, 2, -2, -2, -2]), 48_000);
    expect(Array.from(output)).toEqual([32767, -32768]);
  });

  it("отказва увеличаване на честотата", () => {
    expect(() => downsampleToInt16(new Float32Array(10), 8_000)).toThrow();
  });
});

describe("rmsLevel", () => {
  it("е 0 при тишина и при празен вход", () => {
    expect(rmsLevel(new Int16Array(160))).toBe(0);
    expect(rmsLevel(new Int16Array(0))).toBe(0);
  });

  it("е 0.5 при сигнал с амплитуда половин скала", () => {
    expect(rmsLevel(new Int16Array([16384, -16384, 16384, -16384]))).toBeCloseTo(0.5);
  });
});
