import { describe, expect, it } from "vitest";
import rawPack from "../../../knowledge-packs/zara-robotics/pack.json";
import { codePattern, MentionFinder } from "./mentions";
import { validatePack } from "./validate";

const pack = validatePack(rawPack);
const finder = new MentionFinder(pack);
const ids = (text: string) => finder.find(text).products.map((p) => p.id);
const families = (text: string) => finder.find(text).families.map((f) => f.id);

describe("пакетът на Zara Robotics", () => {
  it("е валиден и има 15 модела", () => {
    expect(pack.products).toHaveLength(15);
  });

  it("всеки модел има източник и поне една група характеристики", () => {
    for (const product of pack.products) {
      expect(product.sourceUrl).toMatch(/^https:\/\/zararobotics\.com\/robots\//);
      expect(Object.keys(product.specs).length).toBeGreaterThan(0);
    }
  });

  it("изрежда какво липсва (цени, отстъпки)", () => {
    expect(pack.missing).toContain("Цени и ценоразпис");
  });
});

describe("разпознаване на модели в разговора", () => {
  it("разпознава кодове в различни изписвания", () => {
    expect(ids("Колко чисти C40S на час?")).toEqual(["kleenbot-c40s"]);
    expect(ids("а c 40 s-а с каква батерия е")).toEqual(["kleenbot-c40s"]);
    expect(ids("С40С ми хареса")).toEqual(["kleenbot-c40s"]); // изцяло на кирилица
    expect(ids("Имате ли нещо по-тясно от Т10?")).toEqual(["dinerbot-t10"]);
    expect(ids("Kleenbot C40 ли беше?")).toEqual(["kleenbot-c40s"]); // без наставката
  });

  it("връща моделите в реда на споменаване", () => {
    expect(ids("Сравнете S300 със S100")).toEqual(["amr-s300", "amr-s100"]);
  });

  it("не бърка сходни кодове", () => {
    expect(ids("T11")).toEqual(["dinerbot-t11"]);
    expect(ids("T1")).toEqual([]);
    expect(ids("C300")).toEqual([]);
  });

  it("не хваща случайни букви и числа в изречения", () => {
    expect(ids("Имат 10 нива и ставка 9%")).toEqual([]);
    expect(ids("т. 10 от договора")).toEqual([]);
    expect(ids("Срещата е в 10 часа, стая 3")).toEqual([]);
  });

  it("не бърка предлозите „в“ и „с“ с модели", () => {
    expect(ids("Да се видим в 3 часа")).toEqual([]); // не W3
    expect(ids("Хотел с 100 стаи")).toEqual([]); // не S100
    expect(ids("Товар с 300 кг")).toEqual([]); // не S300
    expect(ids("Хотел със S100 и W3")).toEqual(["amr-s100", "butlerbot-w3"]);
  });

  it("разпознава серия без конкретен модел", () => {
    expect(families("Интересуват ни клийнботите")).toEqual(["kleenbot"]);
    expect(families("Имате ли робот сервитьор за тераса?")).toEqual(["dinerbot"]);
    // Ако моделът е споменат, серията не се дублира.
    expect(families("Клийнбот C30 ли да вземем?")).toEqual([]);
  });

  it("codePattern отказва невалиден код", () => {
    expect(() => codePattern("40")).toThrow();
  });
});

describe("validatePack", () => {
  it("хваща повторен код и липсващ източник", () => {
    const broken = structuredClone(rawPack);
    broken.products[1]!.code = "C40S";
    broken.products[2]!.sourceUrl = "";
    expect(() => validatePack(broken)).toThrow(/C40S се повтаря[\s\S]*липсва източник/);
  });
});
