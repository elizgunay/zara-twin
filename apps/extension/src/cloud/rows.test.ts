import { describe, expect, it } from "vitest";
import { MeetingRecorder } from "../meetings/report";
import { cleanCode, projectOrigin, reportToRow } from "./rows";

describe("reportToRow", () => {
  it("превръща обобщението в ред за таблото, без текст от разговора", () => {
    const start = Date.UTC(2026, 9, 19, 10, 0);
    const rec = new MeetingRecorder("abc-defg-hij", start);
    rec.onHint({ key: "objection:price", kind: "objection", title: "Възражение: цена", lines: [] }, start + 60_000);
    const report = rec.report({ ownerMs: 120_000.4, counterpartMs: 90_000, ownerShare: 0.57 }, start + 20 * 60_000);
    const row = reportToRow(report, "org-1", "user-1");
    expect(row).toMatchObject({
      org_id: "org-1",
      user_id: "user-1",
      meeting_code: "abc-defg-hij",
      started_at: "2026-10-19T10:00:00.000Z",
      ended_at: "2026-10-19T10:20:00.000Z",
      owner_ms: 120_000,
      counterpart_ms: 90_000,
      objections: [{ id: "price", label: "Възражение: цена", atMs: 60_000, again: false }],
      next_step: null,
    });
    expect(Object.keys(row)).not.toContain("lines");
  });
});

describe("помощници", () => {
  it("приема адрес с /rest/v1/ и отказва http", () => {
    expect(projectOrigin("https://abc.supabase.co/rest/v1/")).toBe("https://abc.supabase.co");
    expect(projectOrigin("http://abc.supabase.co")).toBe("");
    expect(projectOrigin("")).toBe("");
  });

  it("кодът от имейла е само цифри", () => {
    expect(cleanCode(" 123 456 ")).toBe("123456");
    expect(cleanCode("12345678")).toBe("12345678");
    expect(cleanCode("12a456")).toBeNull();
    expect(cleanCode("123")).toBeNull();
  });
});
