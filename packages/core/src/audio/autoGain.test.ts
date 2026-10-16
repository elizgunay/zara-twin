import { describe, expect, it } from "vitest";
import { AutoGain } from "./autoGain";
import { rmsLevel } from "./pcm";

const frame = (level: number) => new Int16Array(1600).fill(Math.round(level * 32768));

describe("AutoGain", () => {
  it("усилва тих говор към целевата сила", () => {
    const gain = new AutoGain();
    let out: Int16Array = new Int16Array();
    for (let i = 0; i < 20; i++) out = gain.process(frame(0.005));
    expect(rmsLevel(out)).toBeGreaterThan(0.05);
  });

  it("не усилва повече от maxGain и не усилва тишината като говор", () => {
    const gain = new AutoGain({ maxGain: 4 });
    for (let i = 0; i < 20; i++) gain.process(frame(0.0001));
    expect(gain.gain).toBe(1);
    for (let i = 0; i < 20; i++) gain.process(frame(0.002));
    expect(gain.gain).toBe(4);
  });

  it("не пипа достатъчно силен говор и не изрязва", () => {
    const gain = new AutoGain();
    const out = gain.process(frame(0.2));
    expect(gain.gain).toBe(1);
    expect(rmsLevel(out)).toBeCloseTo(0.2, 2);
  });
});
