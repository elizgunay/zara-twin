import type { SttSegment } from "@zara-twin/core";
import { describe, expect, it, vi } from "vitest";
import { isLikelyHallucination } from "./hallucinations";
import { WhisperLocalProvider, type Transcriber } from "./whisperProvider";

const FRAME = 1600;
const chunk = (speech: boolean, capturedAt: number) => ({
  source: "tab" as const,
  pcm: new Int16Array(FRAME).fill(speech ? 3000 : 0),
  sampleRate: 16_000,
  capturedAt,
});

function fakeTranscriber(texts: string[]): Transcriber {
  return { id: "fake", transcribe: vi.fn(async () => texts.shift() ?? "") };
}

async function run(transcriber: Transcriber, pattern: string) {
  const segments: SttSegment[] = [];
  const errors: Error[] = [];
  const stream = await new WhisperLocalProvider(transcriber).openStream({
    speaker: "counterpart",
    sampleRate: 16_000,
    onSegment: (s) => segments.push(s),
    onError: (e) => errors.push(e),
  });
  [...pattern].forEach((c, i) => stream.write(chunk(c === "s", 10_000 + i * 100)));
  await stream.close();
  return { segments, errors };
}

describe("WhisperLocalProvider", () => {
  it("връща по един сегмент за изказване, с говорещия и времената", async () => {
    const { segments } = await run(fakeTranscriber(["Добър ден.", "Колко струва?"]), "sssss.......ssss");
    expect(segments.map((s) => s.text)).toEqual(["Добър ден.", "Колко струва?"]);
    expect(segments[0]).toMatchObject({
      speaker: "counterpart",
      startMs: 0,
      endMs: 500,
      isFinal: true,
      providerId: "whisper-local:fake",
      // Последното парче е при 10 000 + 10 × 100 ms, а 600 ms от него са тишина.
      speechEndedAt: 11_000 - 600,
    });
  });

  it("пропуска празни резултати и халюцинации", async () => {
    const { segments } = await run(fakeTranscriber(["  ", "Абонирайте се!"]), "sssss.......sssss.......");
    expect(segments).toEqual([]);
  });

  it("предава грешките на модела, без да спира потока", async () => {
    const transcriber: Transcriber = {
      id: "broken",
      transcribe: vi.fn().mockRejectedValueOnce(new Error("OOM")).mockResolvedValueOnce("Второто мина."),
    };
    const { segments, errors } = await run(transcriber, "sssss.......sssss.......");
    expect(errors.map((e) => e.message)).toEqual(["OOM"]);
    expect(segments.map((s) => s.text)).toEqual(["Второто мина."]);
  });

  it("отказва звук, който не е 16 kHz", async () => {
    const provider = new WhisperLocalProvider(fakeTranscriber([]));
    await expect(
      provider.openStream({ speaker: "owner", sampleRate: 48_000, onSegment: () => {}, onError: () => {} }),
    ).rejects.toThrow(/16000/);
  });
});

describe("isLikelyHallucination", () => {
  it("хваща типичните фрази от субтитри", () => {
    expect(isLikelyHallucination("Абонирайте се!")).toBe(true);
    expect(isLikelyHallucination("Благодаря за гледането.")).toBe(true);
    expect(isLikelyHallucination("...")).toBe(true);
  });

  it("не пипа истински изречения", () => {
    expect(isLikelyHallucination("Продължава ли гаранцията след втората година?")).toBe(false);
    expect(isLikelyHallucination("Благодаря за срещата.")).toBe(false);
  });
});
