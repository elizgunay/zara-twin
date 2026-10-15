import { describe, expect, it } from "vitest";
import { decodeWav } from "./wav";

function makeWav(samples: number[][], sampleRate: number, extraChunk = false): Uint8Array {
  const channels = samples[0]!.length;
  const dataSize = samples.length * channels * 2;
  const extra = extraChunk ? 8 + 3 + 1 : 0; // блок с нечетен размер + подравняване
  const buffer = new ArrayBuffer(44 + extra + dataSize);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  let offset = 36;
  if (extraChunk) {
    write(offset, "LIST");
    view.setUint32(offset + 4, 3, true);
    offset += 12;
  }
  write(offset, "data");
  view.setUint32(offset + 4, dataSize, true);
  offset += 8;
  for (const frame of samples) for (const value of frame) {
    view.setInt16(offset, value, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

describe("decodeWav", () => {
  it("чете моно 16-битов PCM", () => {
    const wav = decodeWav(makeWav([[0], [16384], [-32768]], 16_000));
    expect(wav.sampleRate).toBe(16_000);
    expect(Array.from(wav.samples)).toEqual([0, 0.5, -1]);
  });

  it("смесва стерео в моно", () => {
    const wav = decodeWav(makeWav([[16384, 0], [-16384, -16384]], 48_000));
    expect(Array.from(wav.samples)).toEqual([0.25, -0.5]);
  });

  it("прескача непознати блокове с нечетен размер", () => {
    const wav = decodeWav(makeWav([[16384]], 22_050, true));
    expect(Array.from(wav.samples)).toEqual([0.5]);
  });

  it("отказва файл, който не е WAV", () => {
    expect(() => decodeWav(new TextEncoder().encode("not a wav file at all"))).toThrow(/не е WAV/);
  });
});
