import { describe, expect, it } from "vitest";
import { parseSchedule } from "./parseSchedule";

// Четвъртък, 15 октомври 2026, 10:00 (местно време)
const NOW = new Date(2026, 9, 15, 10, 0);
const d = (month: number, day: number, hour = 0, minute = 0) => new Date(2026, month - 1, day, hour, minute);

describe("parseSchedule", () => {
  it("„следващата сряда в 10“ = сряда от следващата седмица, 10:00–11:00", () => {
    expect(parseSchedule("Да се видим следващата сряда в 10", NOW)).toEqual({
      start: d(10, 21, 10),
      end: d(10, 21, 11),
      exactTime: true,
      label: "сряда, 21 окт., 10:00",
    });
  });

  it("различава „в петък“ (утре) от „следващия петък“", () => {
    expect(parseSchedule("в петък в 11 удобно ли е", NOW)?.start).toEqual(d(10, 16, 11));
    expect(parseSchedule("следващия петък в 11 удобно ли е", NOW)?.start).toEqual(d(10, 23, 11));
    expect(parseSchedule("другата седмица в петък в 11", NOW)?.start).toEqual(d(10, 23, 11));
  });

  it("„в 3“ в бизнес разговор е 15:00, „в 2 следобед“ е 14:00", () => {
    expect(parseSchedule("утре в 3 часа", NOW)?.start).toEqual(d(10, 16, 15));
    expect(parseSchedule("утре в 2 следобед", NOW)?.start).toEqual(d(10, 16, 14));
    expect(parseSchedule("утре следобед в 4", NOW)?.start).toEqual(d(10, 16, 16));
  });

  it("разпознава минути в различни изписвания", () => {
    expect(parseSchedule("вдругиден в 10 и половина", NOW)?.start).toEqual(d(10, 17, 10, 30));
    expect(parseSchedule("в понеделник в 9:30", NOW)?.start).toEqual(d(10, 19, 9, 30));
    expect(parseSchedule("в понеделник в 9 и 15", NOW)?.start).toEqual(d(10, 19, 9, 15));
  });

  it("разпознава дата с месец, а минала дата е следващата година", () => {
    expect(parseSchedule("Може ли оглед на 22-ри октомври в 11 часа?", NOW)?.start).toEqual(d(10, 22, 11));
    expect(parseSchedule("Среща на 5 януари в 10", NOW)?.start).toEqual(new Date(2027, 0, 5, 10));
    expect(parseSchedule("Срещата е на 3.11 в 14", NOW)?.start).toEqual(d(11, 3, 14));
  });

  it("част от деня без точен час дава интервал", () => {
    expect(parseSchedule("в петък следобед удобно ли ви е", NOW)).toEqual({
      start: d(10, 16, 13),
      end: d(10, 16, 18),
      exactTime: false,
      label: "петък, 16 окт., следобед",
    });
  });

  it("ден с дума за среща, без час, дава целия работен ден", () => {
    expect(parseSchedule("Да направим срещата в сряда", NOW)).toMatchObject({
      start: d(10, 21, 9),
      end: d(10, 21, 18),
      exactTime: false,
      label: "сряда, 21 окт.",
    });
  });

  it("не реагира, когато не се уговаря час", () => {
    expect(parseSchedule("В петък доставихме три робота", NOW)).toBeNull();
    expect(parseSchedule("Хотелът е на 3 етажа", NOW)).toBeNull();
    expect(parseSchedule("Роботът работи в 3 етажа в сряда", NOW)).toBeNull();
    expect(parseSchedule("В сряда сме в 2 смени", NOW)).toBeNull();
    expect(parseSchedule("Добър ден, чувате ли ме?", NOW)).toBeNull();
  });
});
