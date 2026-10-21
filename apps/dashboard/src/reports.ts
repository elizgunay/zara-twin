// Сметките за раздела „Срещи“: обобщенията от разширението (таблица meeting_reports).
// Чиста логика, без мрежа и DOM: лесна за тестване.

export interface ReportRow {
  id: string;
  user_id: string;
  meeting_code: string;
  started_at: string;
  ended_at: string;
  owner_ms: number;
  counterpart_ms: number;
  monologues: number;
  hints: number;
  /** Тестова среща (бутон „Тест“ в панела). Липсва, докато не е пусната миграция 0003. */
  is_test?: boolean;
  score: number;
  objections: { id: string; label: string; atMs: number; again: boolean }[];
  products: string[];
  next_step: { label: string; atMs: number } | null;
  notes: string[];
  /** Текстът на разговора (миграция 0004). Празен след срока на фирмата. */
  lines?: TranscriptLine[];
}

/** Карта, която Copilot показа за реда: заглавие, репликите и откъде (готова, по смисъл, AI). */
export interface LineCard {
  title: string;
  say?: string[];
  via: "phrase" | "meaning" | "ai";
}

export interface TranscriptLine {
  speaker: "owner" | "counterpart";
  text: string;
  at: number;
  cards?: LineCard[];
}

export interface ReportStats {
  count: number;
  /** Средна оценка (1–10) или null без срещи. */
  avgScore: number | null;
  withNextStep: number;
  /** В колко срещи клиентът е казал „ще си помисля“. */
  thinkMeetings: number;
  /** Среден дял на говоренето на продавача (0–1) или null. */
  avgOwnerShare: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function stats(rows: ReportRow[]): ReportStats {
  const shares = rows.map((r) => r.owner_ms + r.counterpart_ms > 0 ? r.owner_ms / (r.owner_ms + r.counterpart_ms) : null).filter((s): s is number => s !== null);
  return {
    count: rows.length,
    avgScore: rows.length ? rows.reduce((sum, r) => sum + r.score, 0) / rows.length : null,
    withNextStep: rows.filter((r) => r.next_step).length,
    thinkMeetings: rows.filter((r) => r.objections.some((o) => o.id === "think")).length,
    avgOwnerShare: shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : null,
  };
}

/** Колко пъти е казано всяко възражение (с повторенията), най-честото първо. */
export function objectionCounts(rows: ReportRow[]): { id: string; label: string; count: number; meetings: number }[] {
  const byId = new Map<string, { id: string; label: string; count: number; meetings: Set<string> }>();
  for (const row of rows) {
    for (const o of row.objections) {
      const item = byId.get(o.id) ?? { id: o.id, label: o.label, count: 0, meetings: new Set<string>() };
      item.count++;
      item.meetings.add(row.id);
      byId.set(o.id, item);
    }
  }
  return [...byId.values()]
    .map(({ meetings, ...rest }) => ({ ...rest, meetings: meetings.size }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "bg-BG"));
}

/** Понеделникът на седмицата (местно време), като ключ „2026-10-19“. */
export function weekStart(iso: string): string {
  const date = new Date(iso);
  const day = (date.getDay() + 6) % 7; // понеделник = 0
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - day);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

/** Средна оценка по седмици, от най-старата към най-новата; само седмици със срещи. */
export function weeklyScores(rows: ReportRow[], weeks = 8): { week: string; avg: number; count: number }[] {
  const byWeek = new Map<string, number[]>();
  for (const row of rows) {
    const key = weekStart(row.started_at);
    byWeek.set(key, [...(byWeek.get(key) ?? []), row.score]);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-weeks)
    .map(([week, scores]) => ({ week, avg: scores.reduce((a, b) => a + b, 0) / scores.length, count: scores.length }));
}

export type ReportKind = "all" | "real" | "test";

/** Срещите от последните N дни (по началото), по желание само на един продавач и само реални или тестови. */
export function filterReports(rows: ReportRow[], days: number, userId: string | null, kind: ReportKind = "all", now = Date.now()): ReportRow[] {
  const since = now - days * DAY_MS;
  return rows.filter(
    (r) =>
      new Date(r.started_at).getTime() >= since &&
      (userId === null || r.user_id === userId) &&
      (kind === "all" || (kind === "test") === (r.is_test === true)),
  );
}

/** Без имена в базата: „Вие“ и „Продавач 1, 2…“ по реда, в който се появяват. */
export function sellerLabels(rows: ReportRow[], me: string): Map<string, string> {
  const labels = new Map<string, string>([[me, "Вие"]]);
  let n = 0;
  for (const row of [...rows].sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    if (!labels.has(row.user_id)) labels.set(row.user_id, `Продавач ${++n}`);
  }
  return labels;
}

/** „24 мин“, „1 ч 05 мин“. */
export function duration(startIso: string, endIso: string): string {
  const minutes = Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000));
  return minutes < 60 ? `${minutes} мин` : `${Math.floor(minutes / 60)} ч ${String(minutes % 60).padStart(2, "0")} мин`;
}

/** „03:12“ от началото на срещата. */
export function offset(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function scoreTone(score: number): "low" | "mid" | "high" {
  return score <= 4 ? "low" : score <= 7 ? "mid" : "high";
}
