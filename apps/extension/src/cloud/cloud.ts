import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MeetingReport } from "../meetings/report";
import { missingColumn, OPTIONAL_COLUMNS, projectOrigin, REPORT_CONFLICT, reportToRow, type ReportRow } from "./rows";

/**
 * Връзка с таблото (Supabase, Франкфурт, Р22). Влиза се с имейл и парола.
 * Сесията се пази в паметта на разширението на този компютър. Правилата в базата (RLS)
 * решават какво може: всеки пише само своите срещи и само във фирма, в която членува.
 */
export const CLOUD_ORG_KEY = "cloudOrgId";
export const CLOUD_SYNC_KEY = "cloudLastSync";
const AUTH_STORAGE_KEY = "zaraCloudAuth";

export interface CloudOrg {
  id: string;
  name: string;
  role: string;
}

export interface CloudStatus {
  configured: boolean;
  email: string | null;
  orgs: CloudOrg[];
  orgId: string | null;
}

export interface SyncResult {
  at: number;
  ok: boolean;
  /** Колко срещи са изпратени (при „Изпрати всички“). */
  count?: number;
  error?: string;
}

const url = projectOrigin(__SUPABASE_URL__);
export const cloudConfigured = url !== "" && __SUPABASE_KEY__.startsWith("sb_publishable_");

// Сесията (ключовете за достъп) стои в chrome.storage.local, общо за настройките и service worker-а.
const storage = {
  getItem: async (key: string) => {
    const value: unknown = (await chrome.storage.local.get(key))[key];
    return typeof value === "string" ? value : null;
  },
  setItem: async (key: string, value: string) => chrome.storage.local.set({ [key]: value }),
  removeItem: async (key: string) => chrome.storage.local.remove(key),
};

let client: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!cloudConfigured) throw new Error("Таблото не е настроено в това разширение (.env: SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY).");
  client ??= createClient(url, __SUPABASE_KEY__, {
    auth: { storage, storageKey: AUTH_STORAGE_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}

/** Вход с имейл и парола: акаунта създава собственикът в Supabase (без имейли и без Brevo). */
export async function signIn(email: string, password: string): Promise<void> {
  if (!password) throw new Error("Въведете парола.");
  const { error } = await db().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw new Error(humanError(error.message));
  // Приема чакащите покани; фирмата се избира сама, ако е само една (cloudStatus).
  await db().rpc("accept_invitations");
  await cloudStatus();
}

export async function signOut(): Promise<void> {
  await db().auth.signOut().catch(() => {});
  // При следващ вход (може и с друг акаунт) всичко се праща наново.
  await chrome.storage.local.remove([CLOUD_ORG_KEY, CLOUD_SYNC_KEY, CLOUD_SYNCED_KEY, AUTH_STORAGE_KEY]);
}

export async function cloudStatus(): Promise<CloudStatus> {
  if (!cloudConfigured) return { configured: false, email: null, orgs: [], orgId: null };
  const { data } = await db().auth.getSession();
  const user = data.session?.user;
  if (!user) return { configured: true, email: null, orgs: [], orgId: null };
  const { data: rows, error } = await db().from("members").select("org_id, role, orgs(name, created_at)").eq("user_id", user.id);
  if (error) throw new Error(humanError(error.message));
  // Най-старата фирма първа: случайно създадена втора фирма не взима срещите.
  const orgs = ((rows ?? []) as unknown as { org_id: string; role: string; orgs: { name: string; created_at: string } | null }[])
    .sort((a, b) => (a.orgs?.created_at ?? "").localeCompare(b.orgs?.created_at ?? ""))
    .map((r) => ({ id: r.org_id, name: r.orgs?.name ?? "", role: r.role }));
  return { configured: true, email: user.email ?? null, orgs, orgId: await pickOrg(orgs) };
}

/**
 * Фирмата, към която отиват срещите: избраната в Опции, иначе най-старата (orgs са подредени).
 * Без това срещите не стигаха до таблото, ако човек е влязъл преди фирмата да е създадена
 * или е създал втора фирма по грешка.
 */
async function pickOrg(orgs: CloudOrg[]): Promise<string | null> {
  const stored: unknown = (await chrome.storage.local.get(CLOUD_ORG_KEY))[CLOUD_ORG_KEY];
  if (orgs.some((o) => o.id === stored)) return stored as string;
  if (orgs.length === 0) return null;
  await chrome.storage.local.set({ [CLOUD_ORG_KEY]: orgs[0]!.id });
  return orgs[0]!.id;
}

export async function chooseOrg(orgId: string): Promise<void> {
  await chrome.storage.local.set({ [CLOUD_ORG_KEY]: orgId });
}

/**
 * Изпраща обобщенията (една или повече срещи). Без вход или без избрана фирма не прави нищо
 * и връща null: дневникът на компютъра си остава и може да се изпрати по-късно.
 */
export async function uploadReports(
  reports: MeetingReport[],
  linesFor: (report: MeetingReport) => ReportRow["lines"] = () => [],
): Promise<SyncResult | null> {
  if (!cloudConfigured || reports.length === 0) return null;
  const { data } = await db().auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return null;
  let orgId: unknown = (await chrome.storage.local.get(CLOUD_ORG_KEY))[CLOUD_ORG_KEY];
  if (typeof orgId !== "string") orgId = (await cloudStatus()).orgId;
  if (typeof orgId !== "string") {
    const result: SyncResult = { at: Date.now(), ok: false, error: "Не сте във фирма в таблото или не е избрана фирма." };
    await chrome.storage.local.set({ [CLOUD_SYNC_KEY]: result });
    return result;
  }
  const rows: Partial<ReportRow>[] = reports.map((r) => reportToRow(r, orgId, userId, linesFor(r)));
  // Ако базата още няма полетата от по-новите миграции, срещата пак стига до таблото, без тях.
  const missing: string[] = [];
  let error: { message: string } | null = null;
  for (let attempt = 0; attempt <= OPTIONAL_COLUMNS.length; attempt++) {
    ({ error } = await db().from("meeting_reports").upsert(rows, { onConflict: REPORT_CONFLICT }));
    const column = error ? missingColumn(error.message) : null;
    if (!column || missing.includes(column)) break;
    missing.push(column);
    for (const row of rows) delete row[column];
  }
  const warning = missing.length ? `Без ${missing.map((c) => MISSING_HINT[c]).join(" и ")}: пуснете ${missing.map((c) => MIGRATION_FOR[c]).join(" и ")} в SQL Editor.` : undefined;
  const result: SyncResult = error
    ? { at: Date.now(), ok: false, error: humanError(error.message) }
    : { at: Date.now(), ok: true, count: rows.length, ...(warning && { error: warning }) };
  await chrome.storage.local.set({ [CLOUD_SYNC_KEY]: result });
  return result;
}

/** Коя среща до коя версия е стигнала до таблото: id → endedAt на изпратената версия. */
export const CLOUD_SYNCED_KEY = "cloudSynced";

/**
 * Праща сам всичко, което още не е в таблото: нови срещи, по-нови версии на срещи и срещите,
 * изпратени без текста (преди миграция 0004). Без бутон; вика се при всеки запис, при старт и при вход.
 */
export async function syncPending(
  reports: MeetingReport[],
  linesFor: (report: MeetingReport) => ReportRow["lines"],
): Promise<SyncResult | null> {
  const stored: unknown = (await chrome.storage.local.get(CLOUD_SYNCED_KEY))[CLOUD_SYNCED_KEY];
  const synced: Record<string, number> = stored && typeof stored === "object" ? (stored as Record<string, number>) : {};
  const pending = reports.filter((r) => synced[r.id] !== r.endedAt);
  if (pending.length === 0) return null;
  const result = await uploadReports(pending, linesFor);
  // Предупреждението („без текста…“) значи, че нещо не е стигнало: опитваме пак следващия път.
  if (result?.ok && !result.error) {
    const next: Record<string, number> = {};
    for (const r of reports) if (synced[r.id] !== undefined) next[r.id] = synced[r.id]!;
    for (const r of pending) next[r.id] = r.endedAt;
    await chrome.storage.local.set({ [CLOUD_SYNCED_KEY]: next });
  }
  return result;
}

const MISSING_HINT: Record<string, string> = { lines: "текста на разговора", is_test: "етикета „Тест“" };
const MIGRATION_FOR: Record<string, string> = { lines: "0004_meeting_text.sql", is_test: "0003_test_meetings.sql" };

function humanError(message: string): string {
  if (/row-level security|permission denied/i.test(message)) return "Нямате права: проверете дали сте поканени във фирмата.";
  if (/invalid login credentials/i.test(message)) return "Грешен имейл или парола.";
  if (/email not confirmed/i.test(message)) return "Акаунтът не е потвърден: в Supabase създайте го с отметка „Auto confirm“.";
  if (/rate limit|too many/i.test(message)) return "Твърде много опити. Изчакайте минута.";
  if (/Failed to fetch|NetworkError/i.test(message)) return "Няма връзка с таблото. Проверете интернета.";
  return message;
}

export interface AiTurn {
  speaker: "client" | "seller";
  text: string;
}

export type AiSuggestion = { ok: true; say: string[] } | { ok: false; error: string };

/**
 * AI отговор (Edge Function suggest, Mistral в ЕС). Само с вход в таблото и избрана фирма:
 * ключът за модела е на сървъра, а функцията пуска само членове на фирмата.
 */
export async function aiSuggest(question: string, turns: AiTurn[], facts: string): Promise<AiSuggestion> {
  if (!cloudConfigured) return { ok: false, error: "Таблото не е настроено." };
  const { data } = await db().auth.getSession();
  if (!data.session) return { ok: false, error: "Няма вход в таблото (Опции → Табло)." };
  let orgId: unknown = (await chrome.storage.local.get(CLOUD_ORG_KEY))[CLOUD_ORG_KEY];
  if (typeof orgId !== "string") orgId = (await cloudStatus()).orgId;
  if (typeof orgId !== "string") return { ok: false, error: "Не е избрана фирма." };
  const { data: body, error } = await db().functions.invoke<AiSuggestion>("suggest", { body: { orgId, facts, turns, question } });
  if (error) {
    // Отговорът на функцията (напр. „Липсва MISTRAL_API_KEY“) е в context на грешката.
    const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
    return { ok: false, error: (detail as { error?: string } | null)?.error ?? error.message };
  }
  return body ?? { ok: false, error: "Празен отговор." };
}
