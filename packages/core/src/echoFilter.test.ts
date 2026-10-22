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

  it("ехо, нарязано различно на двата източника (тест в Meet, 22.10.2026)", () => {
    const filter = new EchoFilter();
    expect(filter.isEcho("counterpart", "Какви са минусите на", 0)).toBe(false);
    expect(filter.isEcho("counterpart", "роботите", 600)).toBe(false);
    // Микрофонът на лаптопа е чул същото като клиента в телефона, но нарязано другояче.
    expect(filter.isEcho("owner", "Какви минусите на", 900)).toBe(true);
    // Кратко истинско „да“ след клиента остава, ако клиентът не го е казал.
    expect(filter.isEcho("owner", "Разбирам ви напълно.", 1500)).toBe(false);
  });
});
