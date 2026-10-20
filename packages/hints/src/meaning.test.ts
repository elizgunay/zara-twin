import { validateMethodPack, validatePack } from "@zara-twin/knowledge";
import { describe, expect, it } from "vitest";
import rawMethod from "../../../knowledge-packs/methods/b2b-sales-bg/method.json";
import rawPack from "../../../knowledge-packs/zara-robotics/pack.json";
import { AnswerDetector } from "./answers";
import { meaningHints, MeaningIndex, meaningIntents, type Embed, type MeaningIntent } from "./meaning";
import { ObjectionDetector } from "./objections";

// Вместо модел: вектор по думите (без окончания). Достатъчно, за да се провери логиката:
// отстъп, „нищо особено“, кратки изречения, паузите на детекторите.
const words = (text: string) => text.toLowerCase().match(/\p{L}+/gu)?.map((w) => w.slice(0, 5)) ?? [];
function fakeEmbed(vocabulary: string[]): Embed {
  return async (texts) =>
    texts.map((text) => {
      const v = vocabulary.map((w) => (words(text).includes(w) ? 1 : 0));
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
}

const intents: MeaningIntent[] = [
  { kind: "answer", id: "price", texts: ["колко струва", "Колко ще ни излезе цялата сума?"] },
  { kind: "answer", id: "service", texts: ["Кой ще го поправи, ако се счупи?"] },
  { kind: "objection", id: "think", texts: ["Трябва да си помисля."] },
  { kind: "neutral", id: "neutral", texts: ["Добре, чувате ли ме?"] },
];
const vocabulary = [...new Set(intents.flatMap((i) => i.texts.flatMap(words)))];

describe("разпознаване по смисъл", () => {
  it("намира най-близката тема", async () => {
    const index = await MeaningIndex.build(intents, fakeEmbed(vocabulary));
    expect(await index.match("А колко ще излезе всичко?")).toMatchObject({ kind: "answer", id: "price" });
    expect(await index.match("Ако се счупи, кой го оправя?")).toMatchObject({ kind: "answer", id: "service" });
  });

  it("мълчи при поздрави, кратки и двусмислени изречения", async () => {
    const index = await MeaningIndex.build(intents, fakeEmbed(vocabulary));
    expect(await index.match("Добре, чувате ли ме сега?")).toBeNull();
    expect(await index.match("Колко струва?")).toBeNull(); // под 3 думи: това е за фразите
    expect(await index.match("Нещо съвсем различно днес.")).toBeNull();
  });

  it("фразите от пакета минават през кеша, разговорът – не", async () => {
    const seen: string[] = [];
    const embed = fakeEmbed(vocabulary);
    const buildEmbed: Embed = async (texts) => {
      seen.push(...texts);
      return embed(texts);
    };
    const index = await MeaningIndex.build(intents, embed, { buildEmbed });
    await index.match("А колко ще излезе всичко?");
    expect(seen).toHaveLength(intents.flatMap((i) => i.texts).length);
    expect(seen).not.toContain("А колко ще излезе всичко?");
  });

  it("подсказката е готовият отговор от пакета, отбелязан „по смисъл“, без повторение", () => {
    const pack = validatePack(rawPack);
    const method = validateMethodPack(rawMethod);
    const answers = new AnswerDetector(pack);
    const objections = new ObjectionDetector(method, pack);
    const [hint] = meaningHints({ kind: "answer", id: "price", score: 0.9, margin: 0.05 }, answers, objections);
    expect(hint).toMatchObject({ key: "answer:price", byMeaning: true, say: pack.answers!.find((a) => a.id === "price")!.say });
    expect(meaningHints({ kind: "answer", id: "price", score: 0.9, margin: 0.05 }, answers, objections)).toEqual([]);
    expect(meaningHints({ kind: "objection", id: "think", score: 0.9, margin: 0.05 }, answers, objections)[0]?.title).toBe("„Трябва да си помисля“");
  });

  it("темите идват от пакета: фрази, примери и „нищо особено“", () => {
    const all = meaningIntents(validatePack(rawPack), validateMethodPack(rawMethod));
    expect(all.find((i) => i.kind === "answer" && i.id === "price")?.texts).toContain("Колко пари ще ни коства?");
    expect(all.find((i) => i.kind === "objection" && i.id === "price")?.texts).toContain("Много е скъпо.");
    expect(all.find((i) => i.kind === "neutral")?.texts).toContain("Не е скъпо.");
  });
});
