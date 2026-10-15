import { describe, expect, it } from "vitest";
import { firstFreeSlot, freeWindows, mergeBusy } from "./freeSlots";

const t = (hour: number, minute = 0) => new Date(2026, 9, 21, hour, minute);
const r = (from: number, to: number) => ({ start: t(from), end: t(to) });

describe("свободни часове", () => {
  it("слива застъпващи се ангажименти", () => {
    expect(mergeBusy([r(14, 15), r(10, 11), { start: t(10, 30), end: t(12) }])).toEqual([
      { start: t(10), end: t(12) },
      { start: t(14), end: t(15) },
    ]);
  });

  it("намира свободните прозорци в работния ден", () => {
    expect(freeWindows([r(10, 11), r(14, 15)], r(9, 18))).toEqual([r(9, 10), r(11, 14), r(15, 18)]);
  });

  it("пропуска прозорци, по-кратки от 30 минути", () => {
    const busy = [{ start: t(9), end: t(10) }, { start: t(10, 20), end: t(18) }];
    expect(freeWindows(busy, r(9, 18))).toEqual([]);
  });

  it("предлага първия свободен час след желания", () => {
    expect(firstFreeSlot([r(10, 11), r(11, 12)], t(10), t(18), 60)).toEqual(r(12, 13));
    expect(firstFreeSlot([r(9, 18)], t(9), t(18), 60)).toBeNull();
  });
});
