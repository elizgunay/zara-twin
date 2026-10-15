import { describe, expect, it, vi } from "vitest";

// workerTranscription създава Worker при зареждане на класа, не на модула, затова импортът е безопасен.
vi.stubGlobal("location", { href: "chrome-extension://test/offscreen.html" });
const { ownsBuffer } = await import("./workerTranscription");

describe("ownsBuffer", () => {
  it("парче със собствен буфер може да се прехвърли", () => {
    expect(ownsBuffer(new Int16Array(1600))).toBe(true);
  });

  it("изглед върху по-голям буфер трябва да се копира", () => {
    const recording = new Int16Array(16_000);
    expect(ownsBuffer(recording.subarray(0, 1600))).toBe(false);
    expect(ownsBuffer(recording.subarray(1600, 3200))).toBe(false);
  });
});
