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
    expect(client(d, "Трябва да питам съдружника.")).toEqual(["objection:authority"]);
    expect(client(d, "Не съм сигурен, че персоналът ще го приеме.")).toEqual(["objection:trust"]);
    expect(client(d, "Имаме и друга оферта.")).toEqual(["objection:competitor"]);
  });

  it("взима условията от профила на бизнеса (метод + профил)", () => {
    const { d } = detector();
    const [hint] = d.onSegment({ speaker: "counterpart", text: "А ако се повреди?" });
    expect(hint).toMatchObject({ kind: "objection", title: "Съмнение дали ще проработи" });
    expect(hint!.lines[2]).toBe("Напомнете: Гаранция до 24 месеца.");
  });

  it("без политика в профила показва само общия съвет, без да измисля", () => {
    const empty = { ...profile, policies: [] };
    const [hint] = new ObjectionDetector(method, empty).onSegment({ speaker: "counterpart", text: "рисковано е" });
    expect(hint!.lines[2]).toBe("Напомнете.");
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
    expect(client(d, "скъпо е")).toHaveLength(1);
    advance(60_000);
    expect(client(d, "наистина е скъпо")).toHaveLength(0);
    advance(121_000);
    expect(client(d, "пак казвам, скъпо е")).toHaveLength(1);
  });

  it("мълчи при обикновен разговор", () => {
    const { d } = detector();
    expect(client(d, "Хотелът има три етажа и асансьор.")).toEqual([]);
    expect(client(d, "Аз съм собственикът на хотела.")).toEqual([]);
  });
});

describe("validateMethodPack", () => {
  it("отказва метод с твърде много съвети", () => {
    const broken = structuredClone(rawMethod);
    broken.objections[0]!.tips.push({ text: "четвърти" });
    expect(() => validateMethodPack(broken)).toThrow(/1–3 съвета/);
  });
});
