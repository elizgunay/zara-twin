import { describe, expect, it } from "vitest";
import { normalizeForWer, wordErrorRate } from "./wer";

describe("normalizeForWer", () => {
  it("маха пунктуацията и уеднаквява малките букви на кирилица", () => {
    expect(normalizeForWer("Здравейте, Господин Петров! Как сте?")).toEqual([
      "здравейте",
      "господин",
      "петров",
      "как",
      "сте",
    ]);
  });

  it("запазва числата и латиницата (имена на модели)", () => {
    expect(normalizeForWer("Kleenbot C40S чисти 1100 м²/ч")).toEqual([
      "kleenbot",
      "c40s",
      "чисти",
      "1100",
      "м²",
      "ч",
    ]);
  });
});

describe("wordErrorRate", () => {
  it("е нула при еднакъв текст", () => {
    expect(wordErrorRate("роботът чисти сам", "Роботът чисти сам.").wer).toBe(0);
  });

  it("брои замяна", () => {
    const result = wordErrorRate("роботът чисти сам", "роботът мие сам");
    expect(result).toMatchObject({ substitutions: 1, deletions: 0, insertions: 0, referenceWords: 3 });
    expect(result.wer).toBeCloseTo(1 / 3);
  });

  it("брои изтриване", () => {
    const result = wordErrorRate("цената е без ддс", "цената без ддс");
    expect(result).toMatchObject({ substitutions: 0, deletions: 1, insertions: 0 });
    expect(result.wer).toBeCloseTo(1 / 4);
  });

  it("брои вмъкване", () => {
    const result = wordErrorRate("цената е без ддс", "цената е без ддс сега");
    expect(result).toMatchObject({ substitutions: 0, deletions: 0, insertions: 1 });
    expect(result.wer).toBeCloseTo(1 / 4);
  });

  it("може да надхвърли 100% при много вмъкнати думи", () => {
    expect(wordErrorRate("да", "да да да да").wer).toBe(3);
  });

  it("отказва празен еталон", () => {
    expect(() => wordErrorRate("  ,. ", "нещо")).toThrow();
  });
});
