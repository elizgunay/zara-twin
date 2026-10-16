// Чиста логика на таблото, без мрежа и без DOM: лесна за тестване.

export type Role = "owner" | "catalog_editor" | "support";
export type Screen = "start" | "proposals" | "meetings" | "memory" | "catalog" | "settings";

export interface Membership {
  orgId: string;
  orgName: string;
  role: Role;
  retentionDays: number;
}

export interface MemoryRow {
  id: string;
  subject: string;
  fact: string;
  approved_at: string;
  source_meeting_id: string | null;
}

/** Адресът на проекта: приема и копиран адрес с „/rest/v1/“ накрая и пази само основата. */
export function projectOrigin(url: string): string {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

/** Кои екрани вижда всяка роля. Срещите и паметта: само собственикът (правилата в базата са същите). */
export function screensFor(role: Role): Screen[] {
  if (role === "owner") return ["start", "proposals", "meetings", "memory", "catalog", "settings"];
  if (role === "catalog_editor") return ["catalog"];
  return ["settings"];
}

export const SCREEN_LABEL: Record<Screen, string> = {
  start: "Начало",
  proposals: "За одобрение",
  meetings: "Срещи",
  memory: "Памет",
  catalog: "Каталог",
  settings: "Настройки",
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Собственик",
  catalog_editor: "Редактор на каталога",
  support: "Поддръжка",
};

/** „#/memory“ → „memory“; непознат или забранен екран → първият позволен. */
export function screenFromHash(hash: string, allowed: Screen[]): Screen {
  const name = hash.replace(/^#\/?/, "") as Screen;
  return allowed.includes(name) ? name : allowed[0] ?? "settings";
}

/** Паметта, групирана по човек или фирма, азбучно; във всяка група най-новото първо. */
export function groupMemories(rows: MemoryRow[], search = ""): { subject: string; items: MemoryRow[] }[] {
  const needle = search.trim().toLocaleLowerCase("bg-BG");
  const groups = new Map<string, MemoryRow[]>();
  for (const row of rows) {
    const haystack = `${row.subject} ${row.fact}`.toLocaleLowerCase("bg-BG");
    if (needle && !haystack.includes(needle)) continue;
    const list = groups.get(row.subject) ?? [];
    list.push(row);
    groups.set(row.subject, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "bg-BG"))
    .map(([subject, items]) => ({ subject, items: items.sort((x, y) => y.approved_at.localeCompare(x.approved_at)) }));
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("bg-BG", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Колко дни остават до автоматичното изтриване на среща. */
export function daysLeft(savedAt: string, retentionDays: number, now = Date.now()): number {
  const expires = new Date(savedAt).getTime() + retentionDays * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((expires - now) / (24 * 60 * 60 * 1000)));
}
