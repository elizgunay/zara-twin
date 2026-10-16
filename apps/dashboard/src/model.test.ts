import { describe, expect, it } from "vitest";
import { daysLeft, groupMemories, isEmail, projectOrigin, screenFromHash, screensFor, type MemoryRow } from "./model";

describe("модел на таблото", () => {
  it("пази само основния адрес на проекта", () => {
    expect(projectOrigin("https://abc.supabase.co/rest/v1/")).toBe("https://abc.supabase.co");
    expect(projectOrigin(" https://abc.supabase.co ")).toBe("https://abc.supabase.co");
    expect(projectOrigin("http://abc.supabase.co")).toBe("");
    expect(projectOrigin("не е адрес")).toBe("");
  });

  it("всяка роля вижда само своите екрани", () => {
    expect(screensFor("owner")).toContain("memory");
    expect(screensFor("catalog_editor")).toEqual(["catalog"]);
    expect(screensFor("support")).not.toContain("meetings");
    expect(screenFromHash("#/memory", screensFor("catalog_editor"))).toBe("catalog");
    expect(screenFromHash("#/meetings", screensFor("owner"))).toBe("meetings");
  });

  it("групира паметта по човек и търси в текста", () => {
    const rows: MemoryRow[] = [
      { id: "1", subject: "Хотел Марица", fact: "Иска 2 робота T8", approved_at: "2026-10-01", source_meeting_id: null },
      { id: "2", subject: "Ресторант Дъб", fact: "Бюджет до 30 000 лв.", approved_at: "2026-10-02", source_meeting_id: null },
      { id: "3", subject: "Хотел Марица", fact: "Решава през март", approved_at: "2026-10-03", source_meeting_id: null },
    ];
    const groups = groupMemories(rows);
    expect(groups.map((g) => g.subject)).toEqual(["Ресторант Дъб", "Хотел Марица"]);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(["3", "1"]);
    expect(groupMemories(rows, "t8").map((g) => g.subject)).toEqual(["Хотел Марица"]);
  });

  it("проверява имейл и смята оставащите дни", () => {
    expect(isEmail("shef@zararobotics.com")).toBe(true);
    expect(isEmail("shef@")).toBe(false);
    const day = 24 * 60 * 60 * 1000;
    expect(daysLeft("2026-10-01T00:00:00Z", 30, Date.parse("2026-10-11T00:00:00Z"))).toBe(20);
    expect(daysLeft("2026-10-01T00:00:00Z", 7, Date.parse("2026-10-01T00:00:00Z") + 30 * day)).toBe(0);
  });
});
