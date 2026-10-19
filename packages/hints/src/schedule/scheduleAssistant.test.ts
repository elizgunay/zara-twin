import type { CalendarProvider, TimeRange } from "@zara-twin/core";
import { describe, expect, it, vi } from "vitest";
import { ScheduleAssistant } from "./scheduleAssistant";

const NOW = new Date(2026, 9, 15, 10, 0); // четвъртък
const wed = (hour: number, minute = 0) => new Date(2026, 9, 21, hour, minute);

function calendarWith(busy: TimeRange[]): CalendarProvider {
  return { id: "fake", busy: vi.fn(async () => busy) };
}

const say = (assistant: ScheduleAssistant, text: string) => assistant.onSegment({ speaker: "counterpart", text });

describe("ScheduleAssistant: уговорка на парчета (истинска среща, 19.10)", () => {
  it("събира датата и часа от няколко реплики на двамата", async () => {
    const assistant = new ScheduleAssistant(null, { now: () => NOW });
    const pieces: [ "owner" | "counterpart", string][] = [
      ["counterpart", "Да се уговорим за"], ["counterpart", "среща"], ["counterpart", "за"], ["counterpart", "21 ви"],
      ["owner", "Октомври"], ["owner", "За десет часа"], ["owner", "Окей, става"],
    ];
    const hints = [];
    for (const [speaker, text] of pieces) hints.push(...(await assistant.onSegment({ speaker, text })));
    // Последната подсказка е с точния час: от нея обобщението взима „следваща стъпка“.
    expect(hints.at(-1)).toMatchObject({ kind: "calendar", title: "Час: сряда, 21 окт., 10:00" });
  });

  it("по-новият час печели пред по-ранния ден", async () => {
    const assistant = new ScheduleAssistant(null, { now: () => NOW });
    await say(assistant, "Удобно ли ви е в понеделник?");
    const [hint] = await say(assistant, "Не, по-добре в петък в 11");
    expect(hint).toMatchObject({ title: "Час: петък, 16 окт., 11:00" });
  });
});

describe("ScheduleAssistant", () => {
  it("предупреждава при конфликт и предлага първия свободен час", async () => {
    const calendar = calendarWith([{ start: wed(10, 30), end: wed(11, 30) }]);
    const assistant = new ScheduleAssistant(calendar, { now: () => NOW });
    expect(await say(assistant, "Да се видим следващата сряда в 10")).toEqual([
      {
        key: expect.any(String),
        kind: "calendar-busy",
        title: "Зает: сряда, 21 окт., 10:00",
        lines: ["Друг ангажимент 10:30–11:30", "Свободно: 11:30–12:30"],
      },
    ]);
    // Пита календара за целия работен ден, за да може да предложи друг час.
    expect(calendar.busy).toHaveBeenCalledWith({ start: wed(9), end: wed(18) });
  });

  it("потвърждава свободен час", async () => {
    const assistant = new ScheduleAssistant(calendarWith([{ start: wed(14), end: wed(15) }]), { now: () => NOW });
    const [hint] = await say(assistant, "следващата сряда в 10 удобно ли е");
    expect(hint).toMatchObject({ kind: "calendar-free", title: "Свободен: сряда, 21 окт., 10:00" });
  });

  it("при част от деня изрежда свободните прозорци", async () => {
    const assistant = new ScheduleAssistant(calendarWith([{ start: wed(14), end: wed(15) }]), { now: () => NOW });
    const [hint] = await say(assistant, "следващата сряда следобед удобно ли е");
    expect(hint).toMatchObject({
      kind: "calendar-free",
      title: "сряда, 21 окт., следобед",
      lines: ["Свободно: 13:00–14:00", "Свободно: 15:00–18:00"],
    });
  });

  it("без календар показва поне конкретната дата", async () => {
    const assistant = new ScheduleAssistant(null, { now: () => NOW });
    const [hint] = await say(assistant, "следващата сряда в 10");
    expect(hint).toMatchObject({ kind: "calendar", title: "Час: сряда, 21 окт., 10:00" });
  });

  it("при грешка в календара не спира, а казва да се провери ръчно", async () => {
    const broken: CalendarProvider = { id: "broken", busy: () => Promise.reject(new Error("401")) };
    const [hint] = await say(new ScheduleAssistant(broken, { now: () => NOW }), "утре в 10");
    expect(hint!.lines).toEqual(["Календарът не отговаря. Проверете ръчно."]);
  });

  it("различава „не е свързан“ от „не отговаря“", async () => {
    const notConnected: CalendarProvider = { id: "x", busy: () => Promise.reject(new Error("not-connected")) };
    const [hint] = await say(new ScheduleAssistant(notConnected, { now: () => NOW }), "утре в 10");
    expect(hint!.lines[0]).toMatch(/не е свързан/);
  });

  it("не повтаря същата проверка и мълчи без уговаряне", async () => {
    const assistant = new ScheduleAssistant(calendarWith([]), { now: () => NOW });
    expect(await say(assistant, "утре в 10")).toHaveLength(1);
    expect(await say(assistant, "значи утре в 10, нали")).toHaveLength(0);
    expect(await say(assistant, "Колко струва C40S?")).toEqual([]);
  });
});
