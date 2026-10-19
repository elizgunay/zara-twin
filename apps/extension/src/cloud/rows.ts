import type { MeetingReport } from "../meetings/report";

/**
 * Обобщението на срещата като ред в таблото (таблица meeting_reports, миграция 0002).
 * Без текста на разговора: само това, което е и в дневника на компютъра.
 */
export interface ReportRow {
  org_id: string;
  user_id: string;
  meeting_code: string;
  started_at: string;
  ended_at: string;
  owner_ms: number;
  counterpart_ms: number;
  monologues: number;
  hints: number;
  /** Тестова среща (миграция 0003). */
  is_test: boolean;
  score: number;
  objections: MeetingReport["objections"];
  products: string[];
  next_step: MeetingReport["nextStep"];
  notes: string[];
  /** Текстът на разговора (миграция 0004); трие се след срока на фирмата. */
  lines: { speaker: "owner" | "counterpart"; text: string; at: number }[];
}

/** Уникален ключ на срещата в базата: същата среща се обновява, не се дублира. */
export const REPORT_CONFLICT = "org_id,user_id,meeting_code,started_at";

export function reportToRow(report: MeetingReport, orgId: string, userId: string, lines: ReportRow["lines"] = []): ReportRow {
  return {
    org_id: orgId,
    user_id: userId,
    meeting_code: report.meetingCode,
    started_at: new Date(report.startedAt).toISOString(),
    ended_at: new Date(report.endedAt).toISOString(),
    owner_ms: Math.round(report.ownerMs),
    counterpart_ms: Math.round(report.counterpartMs),
    monologues: report.monologues,
    hints: report.hints,
    is_test: report.test === true,
    score: report.score,
    objections: report.objections,
    products: report.products,
    next_step: report.nextStep,
    notes: report.notes,
    lines: lines.slice(-5000),
  };
}

/** Полетата от по-новите миграции: ако базата още ги няма, срещата се праща без тях. */
export const OPTIONAL_COLUMNS = ["lines", "is_test"] as const;

/** Коя колона липсва в базата, по грешката на Supabase („Could not find the 'lines' column…“). */
export function missingColumn(message: string): (typeof OPTIONAL_COLUMNS)[number] | null {
  return OPTIONAL_COLUMNS.find((c) => new RegExp(`'${c}' column|column "?${c}"? (of relation .* )?does not exist`, "i").test(message)) ?? null;
}

/** Адресът на проекта: приема и копиран адрес с „/rest/v1/“ накрая (като в таблото). */
export function projectOrigin(url: string): string {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" ? parsed.origin : "";
  } catch {
    return "";
  }
}
