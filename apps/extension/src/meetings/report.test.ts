import type { Hint } from "@zara-twin/hints";
import { describe, expect, it } from "vitest";
import { MeetingLog } from "./log";
import { formatDuration, formatOffset, isMeetingReport, MeetingRecorder } from "./report";

const START = 1_000_000;
const min = (n: number) => n * 60_000;
const hint = (key: string, kind: Hint["kind"], title: string): Hint => ({ key, kind, title, lines: [] });

describe("MeetingRecorder", () => {
  it("събира възраженията, роботите и уговорения час", () => {
    const rec = new MeetingRecorder("abc-defg-hij", START);
    rec.onHint(hint("product:dinerbot-t9", "product", "Keenon Dinerbot T9"), START + min(2));
    rec.onHint(hint("objection:think", "objection", "„Трябва да си помисля“"), START + min(3) + 12_000);
    rec.onHint(hint("objection:think:again", "objection", "„Трябва да си помисля“ – пак"), START + min(5));
    rec.onHint(hint("product:dinerbot-t9", "product", "Keenon Dinerbot T9"), START + min(6));
    rec.onHint(hint("schedule:x", "calendar-free", "Свободен: четвъртък, 10:00"), START + min(9));
    const report = rec.report({ ownerMs: min(5), counterpartMs: min(5), ownerShare: 0.5 }, START + min(10));

    expect(report.products).toEqual(["Keenon Dinerbot T9"]);
    expect(report.objections).toEqual([
      { id: "think", label: "„Трябва да си помисля“", atMs: min(3) + 12_000, again: false },
      { id: "think", label: "„Трябва да си помисля“", atMs: min(5), again: true },
    ]);
    expect(report.nextStep).toEqual({ label: "четвъртък, 10:00", atMs: min(9) });
    expect(report.hints).toBe(5);
    expect(report.notes[0]).toBe("Следваща стъпка: четвъртък, 10:00.");
    expect(report.score).toBe(9); // само повтореното възражение
    expect(isMeetingReport(report)).toBe(true);
  });

  it("без уговорен час след „ще си помисля“ и с много говорене оценката пада", () => {
    const rec = new MeetingRecorder("abc-defg-hij", START);
    rec.onHint(hint("objection:think", "objection", "„Трябва да си помисля“"), START + min(4));
    rec.onHint(hint("talk:monologue", "talk", "Говорите 70 s без пауза"), START + min(6));
    const report = rec.report({ ownerMs: min(8), counterpartMs: min(2), ownerShare: 0.8 }, START + min(12));

    expect(report.notes[0]).toBe("Няма уговорен ден и час за следваща стъпка.");
    expect(report.notes).toContain("Говорихте 80% от времето: клиентът почти не се изказа.");
    expect(report.notes).toContain("1 път говорихте над минута без пауза.");
    expect(report.score).toBe(2); // 10 − 3 − 1 − 3 − 1
  });

  it("при кратко говорене не съди за дела", () => {
    const report = new MeetingRecorder("abc-defg-hij", START).report({ ownerMs: 20_000, counterpartMs: 5_000, ownerShare: 0.8 }, START + min(1));
    expect(report.notes.some((n) => n.startsWith("Говорихте"))).toBe(false);
  });
});

describe("isMeetingReport", () => {
  it("отказва повреден запис", () => {
    const good = new MeetingRecorder("abc-defg-hij", START).report({ ownerMs: 0, counterpartMs: 0, ownerShare: null }, START);
    expect(isMeetingReport(good)).toBe(true);
    expect(isMeetingReport({ ...good, score: 11 })).toBe(false);
    expect(isMeetingReport({ ...good, meetingCode: "" })).toBe(false);
    expect(isMeetingReport({ ...good, endedAt: START - 1 })).toBe(false);
    expect(isMeetingReport({ ...good, notes: ["x".repeat(301)] })).toBe(false);
    expect(isMeetingReport(null)).toBe(false);
  });
});

describe("MeetingLog", () => {
  function memory() {
    const data: Record<string, unknown> = {};
    return { get: async (key: string) => ({ [key]: data[key] }), set: async (items: Record<string, unknown>) => void Object.assign(data, items) };
  }
  const reportAt = (code: string, start: number) =>
    new MeetingRecorder(code, start).report({ ownerMs: 0, counterpartMs: 0, ownerShare: null }, start + min(10));

  it("презаписва същата среща, подрежда най-новите първи и трие след 90 дни", async () => {
    let now = START + min(60);
    const log = new MeetingLog(memory(), () => now);
    await log.save(reportAt("aaa-aaaa-aaa", START));
    await log.save(reportAt("bbb-bbbb-bbb", START + min(20)));
    await log.save({ ...reportAt("aaa-aaaa-aaa", START), hints: 7 });
    const list = await log.list();
    expect(list.map((r) => r.meetingCode)).toEqual(["bbb-bbbb-bbb", "aaa-aaaa-aaa"]);
    expect(list[1]!.hints).toBe(7);

    now = START + 91 * 24 * 60 * 60_000;
    expect(await log.list()).toEqual([]);
  });
});

describe("форматиране", () => {
  it("показва продължителност и момент от срещата", () => {
    expect(formatDuration(min(12))).toBe("12 мин");
    expect(formatDuration(min(65))).toBe("1 ч 05 мин");
    expect(formatOffset(min(3) + 12_000)).toBe("03:12");
  });
});
