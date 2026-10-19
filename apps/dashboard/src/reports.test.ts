import { describe, expect, it } from "vitest";
import { duration, filterReports, objectionCounts, sellerLabels, stats, weekStart, weeklyScores, type ReportRow } from "./reports";

function row(over: Partial<ReportRow>): ReportRow {
  return {
    id: "r", user_id: "me", meeting_code: "abc-defg-hij", started_at: "2026-10-19T10:00:00Z", ended_at: "2026-10-19T10:24:00Z",
    owner_ms: 60_000, counterpart_ms: 60_000, monologues: 0, hints: 0, score: 8, objections: [], products: [], next_step: null, notes: [],
    ...over,
  };
}
const think = { id: "think", label: "„Трябва да си помисля“", atMs: 0, again: false };
const price = { id: "price", label: "Възражение: цена", atMs: 0, again: false };

describe("отчети за срещите", () => {
  it("смята средна оценка, уговорени часове и „ще си помисля“", () => {
    const rows = [
      row({ id: "1", score: 10, next_step: { label: "четвъртък, 10:00", atMs: 0 }, objections: [think] }),
      row({ id: "2", score: 4, owner_ms: 90_000, counterpart_ms: 30_000, objections: [think, { ...think, again: true }, price] }),
    ];
    expect(stats(rows)).toEqual({ count: 2, avgScore: 7, withNextStep: 1, thinkMeetings: 2, avgOwnerShare: 0.625 });
    expect(stats([])).toMatchObject({ count: 0, avgScore: null, avgOwnerShare: null });
    expect(objectionCounts(rows)).toEqual([
      { id: "think", label: "„Трябва да си помисля“", count: 3, meetings: 2 },
      { id: "price", label: "Възражение: цена", count: 1, meetings: 1 },
    ]);
  });

  it("групира по седмици от понеделник", () => {
    expect(weekStart("2026-10-19T10:00:00")).toBe("2026-10-19"); // понеделник
    expect(weekStart("2026-10-25T20:00:00")).toBe("2026-10-19"); // неделя
    const weeks = weeklyScores([
      row({ started_at: "2026-10-13T10:00:00", score: 4 }),
      row({ started_at: "2026-10-19T10:00:00", score: 6 }),
      row({ started_at: "2026-10-21T10:00:00", score: 8 }),
    ]);
    expect(weeks).toEqual([{ week: "2026-10-12", avg: 4, count: 1 }, { week: "2026-10-19", avg: 7, count: 2 }]);
  });

  it("филтрира по период и продавач и именува продавачите без имейли", () => {
    const now = new Date("2026-10-19T12:00:00Z").getTime();
    const rows = [
      row({ id: "a", user_id: "me", started_at: "2026-10-18T10:00:00Z" }),
      row({ id: "b", user_id: "u2", started_at: "2026-10-01T10:00:00Z" }),
      row({ id: "c", user_id: "u3", started_at: "2026-10-19T09:00:00Z" }),
    ];
    expect(filterReports(rows, 7, null, "all", now).map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterReports(rows, 30, "u2", "all", now).map((r) => r.id)).toEqual(["b"]);
    const mixed = [...rows, row({ id: "t", is_test: true, started_at: "2026-10-19T08:00:00Z" })];
    expect(filterReports(mixed, 7, null, "test", now).map((r) => r.id)).toEqual(["t"]);
    // Без миграция 0003 полето липсва: срещата се брои за реална.
    expect(filterReports(mixed, 7, null, "real", now).map((r) => r.id)).toEqual(["a", "c"]);
    expect([...sellerLabels(rows, "me").entries()]).toEqual([["me", "Вие"], ["u2", "Продавач 1"], ["u3", "Продавач 2"]]);
  });

  it("показва продължителност", () => {
    expect(duration("2026-10-19T10:00:00Z", "2026-10-19T10:24:00Z")).toBe("24 мин");
    expect(duration("2026-10-19T10:00:00Z", "2026-10-19T11:05:00Z")).toBe("1 ч 05 мин");
  });
});
