import { validatePack } from "@zara-twin/knowledge";
import { describe, expect, it } from "vitest";
import rawPack from "../../../knowledge-packs/zara-robotics/pack.json";
import { HintEngine } from "./engine";

const pack = validatePack(rawPack);

function engineAt(start = 0) {
  let now = start;
  const engine = new HintEngine(pack, { now: () => now });
  return { engine, advance: (ms: number) => (now += ms) };
}

const say = (engine: HintEngine, text: string) => engine.onSegment({ speaker: "counterpart", text });

describe("HintEngine", () => {
  it("показва карта на споменат модел", () => {
    const { engine } = engineAt();
    const [hint] = say(engine, "Колко квадрата чисти C40S на час?");
    expect(hint).toMatchObject({ key: "product:kleenbot-c40s", kind: "product", title: "Keenon Kleenbot C40S" });
    expect(hint!.lines[0]).toBe("Ефективност: до 1 100 м²/час");
  });

  it("не повтаря същата подсказка 2 минути", () => {
    const { engine, advance } = engineAt();
    expect(say(engine, "C40S")).toHaveLength(1);
    advance(60_000);
    expect(say(engine, "пак за C40S")).toHaveLength(0);
    advance(61_000);
    expect(say(engine, "и още веднъж C40S")).toHaveLength(1);
  });

  it("при серия без модел изрежда моделите ѝ", () => {
    const { engine } = engineAt();
    const [hint] = say(engine, "Интересуват ни клийнботите");
    expect(hint).toMatchObject({ kind: "family", title: "Серия Kleenbot: 4 модела" });
    expect(hint!.lines).toHaveLength(4);
    expect(hint!.lines[0]).toMatch(/^C40S: /);
  });

  it("при въпрос за цена казва „няма данни“, вместо да гадае", () => {
    const { engine } = engineAt();
    const hints = say(engine, "Добре, а колко струва T10?");
    expect(hints.map((h) => h.key)).toEqual(["product:dinerbot-t10", "no-data:price"]);
  });

  it("разпознава въпроси за отстъпка и наем", () => {
    const { engine } = engineAt();
    expect(say(engine, "Ще ни направите ли отстъпка?").map((h) => h.key)).toEqual(["no-data:discount"]);
    const [lease] = say(engine, "Може ли на лизинг или под наем?");
    expect(lease).toMatchObject({ key: "policy:purchase" });
    expect(lease!.lines[0]).toMatch(/само за покупка/);
  });

  it("мълчи, когато няма за какво да помогне", () => {
    const { engine } = engineAt();
    expect(say(engine, "Добър ден, чувате ли ме добре?")).toEqual([]);
    expect(say(engine, "Хотелът е с 100 стаи и три етажа")).toEqual([]);
  });

  it("показва най-много 2 модела от едно изречение", () => {
    const { engine } = engineAt();
    expect(say(engine, "T8, T9 или T10, кой е по-добър?").map((h) => h.key)).toEqual([
      "product:dinerbot-t8",
      "product:dinerbot-t9",
    ]);
  });
});
