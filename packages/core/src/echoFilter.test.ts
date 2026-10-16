import { describe, expect, it } from "vitest";
import { EchoFilter } from "./echoFilter";

describe("EchoFilter", () => {
  it("маха същото изречение от другия източник до 3 s по-късно", () => {
    const filter = new EchoFilter();
    expect(filter.isEcho("owner", "Колко струва роботът T8?", 0)).toBe(false);
    expect(filter.isEcho("counterpart", "колко струва роботът T8", 800)).toBe(true);
  });

  it("хваща ехо и когато единият източник е чул само част", () => {
    const filter = new EchoFilter();
    expect(filter.isEcho("owner", "T8", 0)).toBe(false);
    expect(filter.isEcho("counterpart", "имате? T8", 600)).toBe(true);
  });

  it("пропуска истински отговор с различни думи", () => {
    const filter = new EchoFilter();
    expect(filter.isEcho("counterpart", "Каква гаранция имате?", 0)).toBe(false);
    expect(filter.isEcho("owner", "Две години на всички модели.", 1500)).toBe(false);
  });

  it("не маха повторение от същия човек и стари изречения", () => {
    const filter = new EchoFilter();
    expect(filter.isEcho("owner", "Да, точно така.", 0)).toBe(false);
    expect(filter.isEcho("owner", "Да, точно така.", 500)).toBe(false);
    expect(filter.isEcho("counterpart", "Да, точно така.", 4000)).toBe(false);
  });
});
