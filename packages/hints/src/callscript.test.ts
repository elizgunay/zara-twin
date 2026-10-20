import { validateMethodPack, validatePack } from "@zara-twin/knowledge";
import { describe, expect, it } from "vitest";
import rawMethod from "../../../knowledge-packs/methods/b2b-sales-bg/method.json";
import rawPack from "../../../knowledge-packs/zara-robotics/pack.json";
import { AnswerDetector } from "./answers";
import { ObjectionDetector } from "./objections";

// Сценарият за обаждане на ръководителя (20.10.2026): каквото казва клиентът → репликата от сценария.
const pack = validatePack(rawPack);
const method = validateMethodPack(rawMethod);

const firstSay = (text: string) => {
  const seg = { speaker: "counterpart" as const, text };
  const [hint] = [...new ObjectionDetector(method, pack).onSegment(seg), ...new AnswerDetector(pack).onSegment(seg)];
  return hint?.say?.[0];
};

describe("сценарият за обаждане", () => {
  it("възраженията дават репликите на ръководителя", () => {
    expect(firstSay("Скъпо е.")).toBe("Разбирам, и точно затова да сметнем: колко ви струва един сервитьор за година?");
    expect(firstSay("Дали ще работи при нас?")).toBe("Точно затова имаме безплатна демонстрация при вас!");
    expect(firstSay("Масите са нагъсто.")).toBe("Малкият минава през 55 см. Ако мине при вас, всичко друго звучи ли ви добре?");
    expect(firstSay("Да питам съдружника.")).toBe("Разбира се. Какво ще попита той първо? Елате заедно на демото.");
    expect(firstSay("Пратете оферта.")).toBe("Ще ви я пратя днес. Кое в нея ще гледате най-внимателно?");
  });

  it("демото завършва с избор между два часа, а наемът е за пробен месец", () => {
    const answers = (text: string) => new AnswerDetector(pack).onSegment({ speaker: "counterpart", text })[0]?.say;
    expect(answers("Може ли демонстрация?")).toContain("Вторник в 15:00 или четвъртък в 11:00?");
    expect(answers("Може ли под наем?")?.[0]).toMatch(/месец под наем/);
  });

  it("„друга оферта“ остава сравнение, не „пратете оферта“", () => {
    expect(firstSay("Имаме друга оферта.")).toBe("Какво ви харесва в другата оферта?");
  });
});
