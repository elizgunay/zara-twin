import { describe, expect, it } from "vitest";
import { UtteranceMerger } from "./merge";

describe("UtteranceMerger", () => {
  it("слепва парчетата от истинската среща в изречения (по говорител)", () => {
    const m = new UtteranceMerger();
    const t = (s: number) => s * 1000;
    expect(m.add("counterpart", "Да се уговорим за", t(41))).toEqual({ text: "Да се уговорим за", merged: false });
    expect(m.add("counterpart", "среща", t(42))).toEqual({ text: "Да се уговорим за среща", merged: true });
    expect(m.add("counterpart", "за", t(44))).toMatchObject({ merged: true });
    expect(m.add("counterpart", "21 ви", t(45))).toEqual({ text: "Да се уговорим за среща за 21 ви", merged: true });
    // Друг говорител започва нов ред.
    expect(m.add("owner", "Октомври", t(48))).toEqual({ text: "Октомври", merged: false });
    expect(m.add("owner", "За десет часа", t(52))).toMatchObject({ merged: false }); // пауза 4 s
  });

  it("точка или дълга пауза затваря реда", () => {
    const m = new UtteranceMerger();
    m.add("owner", "Добре.", 0);
    expect(m.add("owner", "Нещо друго", 500).merged).toBe(false);
    expect(m.add("owner", "след пауза", 4_000).merged).toBe(false);
  });

  it("препинателните знаци се лепят без интервал", () => {
    const m = new UtteranceMerger();
    m.add("owner", "Скъпо е", 0);
    expect(m.add("owner", "?", 300).text).toBe("Скъпо е?");
  });
});
