import { describe, expect, it } from "vitest";
import rawPack from "../../../knowledge-packs/zara-robotics/pack.json";
import { productCard } from "./card";
import { codePattern, MentionFinder } from "./mentions";
import { validatePack } from "./validate";
import { sttVocabulary } from "./vocabulary";
import { aiFacts } from "./aiFacts";
import rawMethod from "../../../knowledge-packs/methods/b2b-sales-bg/method.json";
import { validateMethodPack } from "./method";

const pack = validatePack(rawPack);
const finder = new MentionFinder(pack);
const ids = (text: string) => finder.find(text).products.map((p) => p.id);
const families = (text: string) => finder.find(text).families.map((f) => f.id);

describe("пакетът на Zara Robotics", () => {
  it("е валиден и има 16 модела (15 Keenon + GreetingBot Mini)", () => {
    expect(pack.products).toHaveLength(16);
  });

  it("всеки модел има източник и поне една група характеристики", () => {
    for (const product of pack.products) {
      // GreetingBot Mini няма страница в каталога: източникът е началната страница.
      expect(product.sourceUrl).toMatch(/^https:\/\/zararobotics\.com\/(robots\/|$)/);
      expect(Object.keys(product.specs).length).toBeGreaterThan(0);
    }
  });

  it("изрежда какво липсва (цени за другите модели, отстъпки)", () => {
    expect(pack.missing).toContain("Цени за моделите извън T8, T9 и GreetingBot Mini");
    expect(pack.missing).toContain("Граници на отстъпките");
  });

  it("цените от собственика са първи в картата", () => {
    const t8 = pack.products.find((p) => p.code === "T8")!;
    expect(t8.price).toBe("8 000 € без ДДС");
    expect(productCard(t8).lines[0]).toBe("Цена: 8 000 € без ДДС");
    expect(productCard(t8).lines).toHaveLength(4);
  });

  it("речникът за говора: марките с произношение, без кодове с цифри", () => {
    const vocab = sttVocabulary(pack);
    expect(vocab).toContainEqual({ content: "Zara Robotics", sounds_like: ["зара роботикс", "зара роботика"] });
    expect(vocab.some((v) => v.content === "Keenon")).toBe(true);
    // „C55“, „W3“ сами по себе си не: правят от числата модели.
    expect(vocab.some((v) => /^\S*\d\S*$/.test(v.content))).toBe(false);
    // Пълните имена на продаваните модели остават; редки имена без произношение – не.
    expect(vocab.some((v) => v.content === "Keenon Dinerbot T9")).toBe(true);
    expect(vocab.some((v) => /Keenmow|XMAN/.test(v.content))).toBe(false);
  });
});

describe("фактите за AI отговорите", () => {
  it("продаваните модели с цена, условията, готовите отговори и какво липсва", () => {
    const facts = aiFacts(pack);
    expect(facts).toContain("Keenon Dinerbot T8 (T8): 8 000 € без ДДС");
    expect(facts).toContain("Минимален проход: 55 см");
    expect(facts).toContain("Гаранция: Гаранция до 24 месеца.");
    expect(facts).toContain("Нямаме данни за:");
    // Моделите без цена са с описание, но без цифри за цена.
    expect(facts).toContain("Други модели (цена: по запитване");
    expect(facts).toContain("Keenon Kleenbot C40S (C40S): Робот 5-в-1");
    expect(facts.length).toBeLessThan(14_000);
  });
});

describe("сценарият на разговора за AI", () => {
  it("целта, стъпките и правилата отиват към AI; грешен сценарий спира метода", () => {
    const method = validateMethodPack(rawMethod);
    const facts = aiFacts(pack, method);
    expect(facts).toContain("Сценарий на разговора. Цел: Уговорена демонстрация");
    expect(facts).toContain("7. Затваряне с дата");
    expect(facts).toContain("Никога без дата");
    const broken = structuredClone(rawMethod) as { playbook: { steps: unknown } };
    broken.playbook.steps = [];
    expect(() => validateMethodPack(broken)).toThrow(/playbook/);
  });
});

describe("примерни изречения за разпознаване по смисъл", () => {
  it("всеки отговор има примери, а грешни примери спират пакета", () => {
    expect(pack.answers!.every((a) => (a.examples?.length ?? 0) >= 3)).toBe(true);
    const broken = structuredClone(rawPack) as { answers: { examples?: unknown }[] };
    broken.answers[0]!.examples = ["", 5];
    expect(() => validatePack(broken)).toThrow(/примерните изречения/);
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

describe("productCard", () => {
  const byId = (id: string) => pack.products.find((p) => p.id === id)!;

  it("показва най-важното за почистващ робот", () => {
    expect(productCard(byId("kleenbot-c40s"))).toEqual({
      title: "Keenon Kleenbot C40S",
      lines: [
        "Ефективност: до 1 100 м²/час",
        "Минимален проход: 65 см",
        "Живот на батерията: 5 ч търкане, 6 ч прахосмучене, 10 ч мокро почистване, 15 ч метене",
        "Режими: Метене / Прахосмучене / Мокро почистване / Търкане / Извличане на вода",
      ],
      sourceUrl: "https://zararobotics.com/robots/kleenbot-c40s",
    });
  });

  it("показва товара и прохода за сервитьор", () => {
    expect(productCard(byId("dinerbot-t11"), 2).lines).toEqual([
      "Товароносимост: 20 кг общо (5 кг средно + 10 кг долно ниво)",
      "Минимален проход: 49 см (най-тесен в серията)",
    ]);
  });

  it("всеки модел има поне 2 реда в картата", () => {
    for (const product of pack.products) {
      expect(productCard(product).lines.length, product.id).toBeGreaterThanOrEqual(2);
    }
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
