import { validateMethodPack, validatePack } from "@zara-twin/knowledge";
import { describe, expect, it } from "vitest";
import rawMethod from "../../../../knowledge-packs/methods/b2b-sales-bg/method.json";
import rawPack from "../../../../knowledge-packs/zara-robotics/pack.json";
import { AnswerDetector } from "../answers";
import { HintEngine } from "../engine";
import { ObjectionDetector } from "../objections";
import { parseSchedule } from "./parseSchedule";

// Сценарий за тест 2 (docs/pilot/Сценарий_за_тест_2.pdf): каквото листът очаква, трябва наистина да излиза.
const NOW = new Date(2026, 9, 19, 16, 0);
const pack = validatePack(rawPack);
const method = validateMethodPack(rawMethod);

function titles(text: string): string[] {
  const seg = { speaker: "counterpart" as const, text };
  return [
    ...new HintEngine(pack).onSegment(seg),
    ...new ObjectionDetector(method, pack).onSegment(seg),
    ...new AnswerDetector(pack).onSegment(seg),
  ].map((h) => h.title);
}

describe("сценарий за тест 2", () => {
  it("всяка реплика дава картата от листа", () => {
    const cases: [string, string][] = [
      ["Разкажете ми за W3.", "Keenon Butlerbot W3"],
      ["А за почистване на фоайето, C55 става ли?", "Keenon Kleenbot C55"],
      ["Имате ли нещо за посрещане на гости?", "OrionStar GreetingBot Mini"],
      ["Кой поддържа робота, ако спре?", "Сервиз и поддръжка"],
      ["Свързва ли се с нашата система за поръчки?", "Връзка с касата и системите"],
      ["Колко бързо ще тръгне при нас?", "Колко бързо тръгва"],
      ["Може ли на лизинг?", "Покупка или наем"],
      ["Персоналът ще се научи ли?", "Обучение"],
      ["Трябва да говоря със собственика.", "Решението е на някой друг"],
      ["Не съм сигурен, че гостите ще го приемат.", "Съмнение дали ще проработи"],
      ["Имаме оферта от друга фирма.", "Сравняват с друга оферта"],
      ["Не сега, след сезона.", "Възражение: не сега"],
      ["Ще го обмислим с колегите.", "„Трябва да си помисля“"],
    ];
    for (const [text, title] of cases) expect(titles(text), text).toContain(title);
  });

  it("капаните мълчат", () => {
    expect(titles("Хотелът има 3 етажа.")).toEqual([]);
    expect(titles("Аз съм собственикът на хотела.")).toEqual([]);
    expect(parseSchedule("Хотелът има 3 етажа.", NOW)).toBeNull();
  });

  it("уговорки по различни начини", () => {
    expect(parseSchedule("Елате утре следобед.", NOW)?.label).toBe("вторник, 20 окт., следобед");
    expect(parseSchedule("Може ли следващия петък в 2?", NOW)?.label).toBe("петък, 30 окт., 14:00");
    expect(parseSchedule("Удобно ли ви е на 3 ноември в 11 часа?", NOW)?.label).toBe("вторник, 3 ное., 11:00");
  });
});
