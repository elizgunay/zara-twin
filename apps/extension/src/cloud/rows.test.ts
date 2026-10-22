import { describe, expect, it } from "vitest";
import { MeetingRecorder } from "../meetings/report";
import { missingColumn, projectOrigin, reportToRow } from "./rows";

describe("reportToRow", () => {
  it("превръща обобщението в ред за таблото (без подаден текст: празен)", () => {
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
    expect(row.lines).toEqual([]);
  });
});

describe("текст и стари бази", () => {
  it("праща текста на разговора с обобщението", () => {
    const report = new MeetingRecorder("abc-defg-hij", 0).report({ ownerMs: 0, counterpartMs: 0, ownerShare: null }, 60_000);
    const lines = [{ speaker: "counterpart" as const, text: "Трябва да си помисля.", at: 5_000 }];
    expect(reportToRow(report, "o", "u", lines).lines).toEqual(lines);
    expect(reportToRow(report, "o", "u").lines).toEqual([]);
  });

  it("разпознава липсваща колона по грешката на Supabase", () => {
    expect(missingColumn("Could not find the 'lines' column of 'meeting_reports' in the schema cache")).toBe("lines");
    expect(missingColumn('column "is_test" of relation "meeting_reports" does not exist')).toBe("is_test");
    expect(missingColumn("new row violates row-level security policy")).toBeNull();
  });
});

describe("клиентът на срещата (0005)", () => {
  it("срещата отива с client_id; без клиент е null; старата база без колоната се разпознава", () => {
    const report = new MeetingRecorder("abc-defg-hij", 0).report({ ownerMs: 0, counterpartMs: 0, ownerShare: null }, 60_000);
    expect(reportToRow(report, "org-1", "user-1").client_id).toBeNull();
    const withClient = { ...report, clientId: "00000000-0000-4000-8000-0000000c0001" };
    expect(reportToRow(withClient, "org-1", "user-1").client_id).toBe("00000000-0000-4000-8000-0000000c0001");
    expect(missingColumn("Could not find the 'client_id' column of 'meeting_reports' in the schema cache")).toBe("client_id");
  });
});

describe("помощници", () => {
  it("приема адрес с /rest/v1/ и отказва http", () => {
    expect(projectOrigin("https://abc.supabase.co/rest/v1/")).toBe("https://abc.supabase.co");
    expect(projectOrigin("http://abc.supabase.co")).toBe("");
    expect(projectOrigin("")).toBe("");
  });
});
