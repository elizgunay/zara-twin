import { validateMethodPack, validatePack } from "@zara-twin/knowledge";
import { describe, expect, it } from "vitest";
import rawMethod from "../../../knowledge-packs/methods/b2b-sales-bg/method.json";
import rawPack from "../../../knowledge-packs/zara-robotics/pack.json";
import { AnswerDetector } from "./answers";
import { NudgeDetector } from "./nudges";
import { ObjectionDetector } from "./objections";
import { parseSchedule } from "./schedule/parseSchedule";

// Фрази от реални разговори на Zara Robotics (20.10.2026; записите са само локално, тук са
// само обезличени фрази): каквото каза клиентът или продавачът → каква подсказка трябва.
const pack = validatePack(rawPack);
const method = validateMethodPack(rawMethod);
const NOW = new Date(2026, 9, 20, 11, 0);

const client = (text: string) => {
  const seg = { speaker: "counterpart" as const, text };
  return [...new AnswerDetector(pack).onSegment(seg), ...new ObjectionDetector(method, pack).onSegment(seg)].map((h) => h.title);
};

describe("реални разговори: въпросите и възраженията на клиента", () => {
  it("всяка фраза дава подсказка", () => {
    const cases: [string, string][] = [
      ["Ориентировъчно колко би струвало това удоволствие?", "Цена"],
      ["В колко пари излиза малкия или големия?", "Цена"],
      ["Мен ме интересува цената.", "Цена"],
      ["Как ще ми направите демонстрация по вайбър ли? Ще ми пратите клип ли?", "Демонстрация"],
      ["Искам да ги видя на живо.", "Демонстрация"],
      ["Фактура издавате ли?", "Фактура и ДДС"],
      ["Софтуерът на български ли е?", "Език"],
      ["А след това поддръжката му, частите?", "Части след гаранцията"],
      ["Имате ли вариант на изплащане?", "Покупка или наем"],
      ["Има ли опция да се програмира за нашата дейност?", "Настройка за вашия обект"],
      ["Ние имаме ресторант от една година.", "Въпроси за обекта"],
      ["Все пак не са малко пари накуп.", "Възражение: цена"],
      // Тест в Meet, 20.10.2026: облакът пише въпросите без „?“.
      ["На каква цена са", "Цена"],
      ["Има ли гаранция", "Гаранция"],
      ["Миглена, разкажете нещо повече за роботите", "Какви роботи има"],
      ["Може ли да ми разкажете повече за робота?", "Какви роботи има"],
      ["Разкажете ми за робота", "Какви роботи има"],
      ["Как работи роботът?", "Какви роботи има"],
    ];
    for (const [text, title] of cases) expect(client(text), text).toContain(title);
  });

  it("цената се показва с моделите и сумите", () => {
    const [hint] = new AnswerDetector(pack).onSegment({ speaker: "counterpart", text: "Колко струва?" });
    expect(hint!.say![0]).toBe("Сервитьорът T8 е 8 000 €, по-големият T9 е 9 000 €, без ДДС.");
  });
});

describe("реални разговори: без лъжливи подсказки (проверено с npm run bench:replay)", () => {
  it("разказ на клиента не е въпрос или възражение", () => {
    expect(client("Като имаме сватби, наемаме персонал допълнително.")).not.toContain("Покупка или наем");
    expect(client("Сега тук ще имаме малко освежителни ремонтни дейности.")).toEqual([]);
    expect(client("То не е толкова въпросът в цената, нали?")).toEqual([]);
    expect(client("Тези роботи от Китай са китайско производство.")).toEqual([]);
  });

  it("„какви предлагате“ и „пратете на вайбъра“", () => {
    expect(client("Какъв тип са или вие предлагате от всичките?")).toContain("Какви роботи има");
    expect(client("Искам да ми пратите на вайбъра да го видя това и ще го реша.")).toContain("„Пратете оферта“");
  });
});

describe("реални разговори: следващата стъпка", () => {
  it("неясно обещание на продавача → конкретна реплика", () => {
    const d = new NudgeDetector(method, { now: () => NOW.getTime() });
    const [hint] = d.onSegment({ speaker: "owner", text: "Ще се опитам до края на седмицата, но няма да обещая." });
    expect(hint).toMatchObject({ key: "nudge:vague", title: "Сложете ден и час" });
  });

  it("обещание с ден и час е наред; клиентът не задейства тази подсказка", () => {
    const d = new NudgeDetector(method, { now: () => NOW.getTime() });
    expect(d.onSegment({ speaker: "owner", text: "Ще ви пратя офертата утре в 17 часа." })).toEqual([]);
    expect(d.onSegment({ speaker: "counterpart", text: "Ще се опитам да дойда." })).toEqual([]);
  });

  it("„на 22-ри да се чуем“ без месец", () => {
    expect(parseSchedule("Надявам се на 22-ри да се чуем да се видим.", NOW)?.label).toBe("четвъртък, 22 окт.");
    // Минал ден → следващия месец.
    expect(parseSchedule("Да се чуем на 5-ти.", NOW)?.label).toBe("четвъртък, 5 ное.");
  });
});
