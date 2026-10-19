import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MeetingReport } from "../meetings/report";
import { cleanCode, projectOrigin, REPORT_CONFLICT, reportToRow } from "./rows";

/**
 * Връзка с таблото (Supabase, Франкфурт, Р22). Влиза се с код от имейла, без парола.
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

/** Праща код за вход на имейла. Поканените от таблото влизат с имейла от поканата. */
export async function sendCode(email: string): Promise<void> {
  const { error } = await db().auth.signInWithOtp({ email: email.trim().toLowerCase() });
  if (error) throw new Error(humanError(error.message));
}

export async function verifyCode(email: string, code: string): Promise<void> {
  const token = cleanCode(code);
  if (!token) throw new Error("Кодът е от цифри, например 123456.");
  const { error } = await db().auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: "email" });
  if (error) throw new Error(humanError(error.message));
  // Приема чакащите покани и избира фирмата, ако е само една.
  await db().rpc("accept_invitations");
  const { orgs } = await cloudStatus();
  if (orgs.length === 1) await chrome.storage.local.set({ [CLOUD_ORG_KEY]: orgs[0]!.id });
}

export async function signOut(): Promise<void> {
  await db().auth.signOut().catch(() => {});
  await chrome.storage.local.remove([CLOUD_ORG_KEY, CLOUD_SYNC_KEY, AUTH_STORAGE_KEY]);
}

export async function cloudStatus(): Promise<CloudStatus> {
  if (!cloudConfigured) return { configured: false, email: null, orgs: [], orgId: null };
  const { data } = await db().auth.getSession();
  const user = data.session?.user;
  if (!user) return { configured: true, email: null, orgs: [], orgId: null };
  const { data: rows, error } = await db().from("members").select("org_id, role, orgs(name)").eq("user_id", user.id);
  if (error) throw new Error(humanError(error.message));
  const orgs = ((rows ?? []) as unknown as { org_id: string; role: string; orgs: { name: string } | null }[]).map((r) => ({
    id: r.org_id,
    name: r.orgs?.name ?? "",
    role: r.role,
  }));
  const stored: unknown = (await chrome.storage.local.get(CLOUD_ORG_KEY))[CLOUD_ORG_KEY];
  const orgId = orgs.some((o) => o.id === stored) ? (stored as string) : null;
  return { configured: true, email: user.email ?? null, orgs, orgId };
}

export async function chooseOrg(orgId: string): Promise<void> {
  await chrome.storage.local.set({ [CLOUD_ORG_KEY]: orgId });
}

/**
 * Изпраща обобщенията (една или повече срещи). Без вход или без избрана фирма не прави нищо
 * и връща null: дневникът на компютъра си остава и може да се изпрати по-късно.
 */
export async function uploadReports(reports: MeetingReport[]): Promise<SyncResult | null> {
  if (!cloudConfigured || reports.length === 0) return null;
  const { data } = await db().auth.getSession();
  const userId = data.session?.user.id;
  const orgId: unknown = (await chrome.storage.local.get(CLOUD_ORG_KEY))[CLOUD_ORG_KEY];
  if (!userId || typeof orgId !== "string") return null;
  const rows = reports.map((r) => reportToRow(r, orgId, userId));
  const { error } = await db().from("meeting_reports").upsert(rows, { onConflict: REPORT_CONFLICT });
  const result: SyncResult = error
    ? { at: Date.now(), ok: false, error: humanError(error.message) }
    : { at: Date.now(), ok: true, count: rows.length };
  await chrome.storage.local.set({ [CLOUD_SYNC_KEY]: result });
  return result;
}

function humanError(message: string): string {
  if (/row-level security|permission denied/i.test(message)) return "Нямате права: проверете дали сте поканени във фирмата.";
  if (/Token has expired|invalid/i.test(message)) return "Кодът е грешен или изтекъл. Поискайте нов.";
  if (/rate limit|too many/i.test(message)) return "Твърде много опити. Изчакайте минута.";
  if (/Failed to fetch|NetworkError/i.test(message)) return "Няма връзка с таблото. Проверете интернета.";
  return message;
}
