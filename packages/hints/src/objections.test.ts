import { validateMethodPack, validatePack } from "@zara-twin/knowledge";
import { describe, expect, it } from "vitest";
import rawMethod from "../../../knowledge-packs/methods/b2b-sales-bg/method.json";
import rawProfile from "../../../knowledge-packs/zara-robotics/pack.json";
import { ObjectionDetector } from "./objections";

const method = validateMethodPack(rawMethod);
const profile = validatePack(rawProfile);

function detector(start = 0) {
  let now = start;
  return { d: new ObjectionDetector(method, profile, { now: () => now }), advance: (ms: number) => (now += ms) };
}
const client = (d: ObjectionDetector, text: string) => d.onSegment({ speaker: "counterpart", text }).map((h) => h.key);

describe("ObjectionDetector", () => {
  it("разпознава основните видове възражения", () => {
    const { d } = detector();
    expect(client(d, "Честно казано, доста е скъпо за нас.")).toEqual(["objection:price"]);
    expect(client(d, "Мисля, че ще го оставим за догодина.")).toEqual(["objection:timing"]);
    expect(client(d, "Добре, трябва да си помисля.")).toEqual(["objection:think"]);
    expect(client(d, "Трябва да питам съдружника.")).toEqual(["objection:authority"]);
    expect(client(d, "Не съм сигурен, че персоналът ще го приеме.")).toEqual(["objection:trust"]);
    expect(client(d, "Имаме и друга оферта.")).toEqual(["objection:competitor"]);
  });

  it("„ще си помисля“ дава готова реплика за казване, не съвет", () => {
    const variants = ["Ще си помисля и ще ви се обадя.", "Нека помислим малко.", "Ще го обмислим с колегите.", "Ще ви върнем отговор."];
    for (const text of variants) {
      const [hint] = detector().d.onSegment({ speaker: "counterpart", text });
      expect(hint, text).toMatchObject({ key: "objection:think" });
      expect(hint!.say![0]).toMatch(/нещо конкретно го спира/);
      expect(hint!.say).toHaveLength(2);
    }
  });

  it("при повторено „ще помисля“ дава по-настоятелни реплики, веднъж на среща", () => {
    const { d, advance } = detector();
    expect(client(d, "Трябва да си помисля.")).toEqual(["objection:think"]);
    advance(5_000);
    // Същото изречение, разделено на части: още не е повторение.
    expect(client(d, "Ще ви се обадим.")).toEqual([]);
    advance(30_000);
    const [again] = d.onSegment({ speaker: "counterpart", text: "Пак казвам, ще го обмислим." });
    expect(again).toMatchObject({ key: "objection:think:again" });
    expect(again!.say![0]).toMatch(/да“ днес/);
    advance(30_000);
    expect(client(d, "Нека помислим.")).toEqual([]);
  });

  it("при повторено „скъпо“ и „не сега“ също дава по-настоятелни реплики", () => {
    const { d, advance } = detector();
    client(d, "Скъпо е.");
    client(d, "Не сега, догодина.");
    advance(30_000);
    expect(client(d, "Все пак е скъпо.")).toEqual(["objection:price:again"]);
    expect(client(d, "Наистина не бързаме.")).toEqual(["objection:timing:again"]);
  });

  it("взима условията от профила на бизнеса (метод + профил)", () => {
    const { d } = detector();
    const [hint] = d.onSegment({ speaker: "counterpart", text: "А ако се повреди?" });
    expect(hint).toMatchObject({ kind: "objection", title: "Съмнение дали ще проработи" });
    expect(hint!.say![0]).toBe("Разбирам ви. Какво точно ви притеснява?");
    expect(hint!.lines).toEqual(["Факт: Гаранция до 24 месеца."]);
  });

  it("без политика в профила показва само общия съвет, без да измисля", () => {
    const empty = { ...profile, policies: [] };
    const [hint] = new ObjectionDetector(method, empty).onSegment({ speaker: "counterpart", text: "рисковано е" });
    expect(hint!.lines).toEqual(["Факт."]);
  });

  it("реагира само на думите на клиента", () => {
    const { d } = detector();
    expect(d.onSegment({ speaker: "owner", text: "Знам, че изглежда скъпо, но…" })).toEqual([]);
  });

  it("не бърка отрицание с възражение", () => {
    const { d } = detector();
    expect(client(d, "Не е скъпо, по-скоро питам за сроковете.")).toEqual([]);
    expect(client(d, "Не е чак толкова рисковано.")).toEqual([]);
    // Фрази, които сами съдържат „не“, си остават възражения.
    expect(client(d, "Не можем да си позволим такава сума.")).toEqual(["objection:price"]);
  });

  it("не повтаря същото възражение 3 минути", () => {
    const { d, advance } = detector();
    expect(client(d, "трябва да питам съдружника")).toHaveLength(1);
    advance(60_000);
    expect(client(d, "ще говоря със съдружника")).toHaveLength(0);
    advance(121_000);
    expect(client(d, "пак казвам, трябва да питам")).toHaveLength(1);
  });

  it("мълчи при обикновен разговор", () => {
    const { d } = detector();
    expect(client(d, "Хотелът има три етажа и асансьор.")).toEqual([]);
    expect(client(d, "Аз съм собственикът на хотела.")).toEqual([]);
  });
});

describe("validateMethodPack", () => {
  it("отказва метод с твърде много или твърде дълги реплики", () => {
    const many = structuredClone(rawMethod);
    many.objections[0]!.say.push("трета");
    expect(() => validateMethodPack(many)).toThrow(/1–2 реплики/);
    const long = structuredClone(rawMethod);
    long.objections[0]!.say[0] = "дума ".repeat(40);
    expect(() => validateMethodPack(long)).toThrow(/твърде дълга/);
  });
});
