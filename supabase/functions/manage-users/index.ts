// Хората във фирмата, от таблото: създаване на потребител с парола, нова парола, списък с имейлите.
// Работи на сървъра на Supabase (Edge Function), защото създаването на акаунт иска главния ключ,
// а той никога не влиза в браузъра. Supabase го дава тук сам (SUPABASE_SERVICE_ROLE_KEY).
// Всяко действие първо проверява, че молбата е от СОБСТВЕНИК на същата фирма.
// Без имейли: паролата се връща на собственика, който я дава на колегата лично.
//
// Качване: Supabase → Edge Functions → Deploy a new function → Via Editor → име manage-users →
// поставете този файл → Deploy. Подробно: docs/setup/supabase.md, раздел 7.

export type Role = "owner" | "seller" | "catalog_editor" | "support";
export const ROLES: readonly Role[] = ["owner", "seller", "catalog_editor", "support"];

export type Request =
  | { action: "list"; orgId: string }
  | { action: "create"; orgId: string; email: string; role: Role }
  | { action: "reset"; orgId: string; userId: string };

export type Response =
  | { ok: true; members: { userId: string; email: string | null; role: Role; createdAt: string }[] }
  | { ok: true; email: string; password: string; existed: boolean }
  | { ok: false; error: string };

/** Каквото функцията иска от Supabase; в тестовете се подменя. */
export interface Admin {
  /** Кой е изпратил молбата (по токена от входа в таблото). */
  caller(jwt: string): Promise<{ id: string } | null>;
  roleIn(orgId: string, userId: string): Promise<Role | null>;
  findByEmail(email: string): Promise<{ id: string } | null>;
  createUser(email: string, password: string): Promise<{ id: string }>;
  setPassword(userId: string, password: string): Promise<void>;
  addMember(orgId: string, userId: string, role: Role): Promise<void>;
  members(orgId: string): Promise<{ user_id: string; role: Role; created_at: string }[]>;
  emailOf(userId: string): Promise<string | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Без лесни за бъркане знаци (0/O, 1/l/I): паролата се диктува или преписва.
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePassword(length = 14, random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = random(length * 2);
  let out = "";
  for (const b of bytes) {
    // Отхвърляне над кратното на азбуката: еднаква вероятност за всеки знак.
    if (b >= 256 - (256 % ALPHABET.length)) continue;
    out += ALPHABET[b % ALPHABET.length];
    if (out.length === length) return out;
  }
  return out.length === length ? out : generatePassword(length, random);
}

export function parseRequest(value: unknown): Request | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.orgId !== "string" || !UUID.test(r.orgId)) return null;
  if (r.action === "list") return { action: "list", orgId: r.orgId };
  if (r.action === "create") {
    const email = typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
    if (!EMAIL.test(email) || email.length > 254 || !ROLES.includes(r.role as Role)) return null;
    return { action: "create", orgId: r.orgId, email, role: r.role as Role };
  }
  if (r.action === "reset" && typeof r.userId === "string" && UUID.test(r.userId)) return { action: "reset", orgId: r.orgId, userId: r.userId };
  return null;
}

export async function handle(jwt: string | null, body: unknown, admin: Admin, newPassword = () => generatePassword()): Promise<{ status: number; body: Response }> {
  const deny = (status: number, error: string) => ({ status, body: { ok: false as const, error } });
  if (!jwt) return deny(401, "Нужен е вход в таблото.");
  const caller = await admin.caller(jwt);
  if (!caller) return deny(401, "Входът е изтекъл. Влезте отново.");
  const request = parseRequest(body);
  if (!request) return deny(400, "Невалидна заявка: проверете имейла и ролята.");
  // Само собственик на СЪЩАТА фирма управлява хората в нея.
  if ((await admin.roleIn(request.orgId, caller.id)) !== "owner") return deny(403, "Само собственикът може да управлява хората.");

  if (request.action === "list") {
    const rows = await admin.members(request.orgId);
    const members = await Promise.all(
      rows.map(async (m) => ({ userId: m.user_id, email: await admin.emailOf(m.user_id), role: m.role, createdAt: m.created_at })),
    );
    return { status: 200, body: { ok: true, members } };
  }

  if (request.action === "create") {
    const password = newPassword();
    const existing = await admin.findByEmail(request.email);
    if (existing && (await admin.roleIn(request.orgId, existing.id))) {
      return deny(409, "Този човек вече е във фирмата. За забравена парола: „Нова парола“ до името му.");
    }
    let userId: string;
    if (existing) {
      // Акаунтът съществува (напр. от стар вход), но не е във фирмата: нова парола и добавяне.
      await admin.setPassword(existing.id, password);
      userId = existing.id;
    } else {
      userId = (await admin.createUser(request.email, password)).id;
    }
    await admin.addMember(request.orgId, userId, request.role);
    return { status: 200, body: { ok: true, email: request.email, password, existed: Boolean(existing) } };
  }

  // reset: само за хора от същата фирма (собственикът не сменя пароли на чужди).
  if (!(await admin.roleIn(request.orgId, request.userId))) return deny(404, "Този човек не е във фирмата.");
  const password = newPassword();
  await admin.setPassword(request.userId, password);
  return { status: 200, body: { ok: true, email: (await admin.emailOf(request.userId)) ?? "", password, existed: true } };
}

// ---------- Връзката със Supabase (изпълнява се само на сървъра, в Deno) ----------

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: globalThis.Request) => Promise<globalThis.Response>): void } | undefined;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Главният ключ на проекта: старият SUPABASE_SERVICE_ROLE_KEY или новият формат
 * SUPABASE_SECRET_KEYS (JSON, напр. {"default":"sb_secret_…"}). Supabase слага един от двата сам.
 */
export function adminKey(env: (name: string) => string | undefined): string | null {
  const legacy = env("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys: unknown = JSON.parse(env("SUPABASE_SECRET_KEYS") ?? "");
    if (keys && typeof keys === "object") {
      const first = Object.values(keys as Record<string, unknown>).find((v) => typeof v === "string" && v.length > 0);
      if (typeof first === "string") return first;
    }
  } catch {
    // няма нов формат
  }
  return null;
}

if (typeof Deno !== "undefined") {
  const { createClient } = await import("npm:@supabase/supabase-js@2.117.2");
  const key = adminKey((name) => Deno!.env.get(name));
  if (!key) throw new Error("Липсва главният ключ на проекта (SUPABASE_SERVICE_ROLE_KEY или SUPABASE_SECRET_KEYS).");
  const db = createClient(Deno.env.get("SUPABASE_URL")!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin: Admin = {
    caller: async (jwt) => (await db.auth.getUser(jwt)).data.user ?? null,
    roleIn: async (orgId, userId) => {
      const { data } = await db.from("members").select("role").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
      return (data?.role as Role | undefined) ?? null;
    },
    findByEmail: async (email) => {
      for (let page = 1; page <= 20; page++) {
        const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw error;
        const hit = data.users.find((u: { email?: string }) => u.email?.toLowerCase() === email);
        if (hit) return { id: hit.id };
        if (data.users.length < 200) return null;
      }
      return null;
    },
    createUser: async (email, password) => {
      const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw error ?? new Error("Акаунтът не беше създаден.");
      return { id: data.user.id };
    },
    setPassword: async (userId, password) => {
      const { error } = await db.auth.admin.updateUserById(userId, { password });
      if (error) throw error;
    },
    addMember: async (orgId, userId, role) => {
      const { error } = await db.from("members").upsert({ org_id: orgId, user_id: userId, role }, { onConflict: "org_id,user_id" });
      if (error) throw error;
      // Стара покана за същия имейл вече не трябва.
      const email = (await db.auth.admin.getUserById(userId)).data.user?.email;
      if (email) await db.from("invitations").delete().eq("org_id", orgId).eq("email", email.toLowerCase());
    },
    members: async (orgId) => {
      const { data, error } = await db.from("members").select("user_id, role, created_at").eq("org_id", orgId).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
    emailOf: async (userId) => (await db.auth.admin.getUserById(userId)).data.user?.email ?? null,
  };

  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    let result: { status: number; body: Response };
    try {
      result = await handle(jwt, await req.json().catch(() => null), admin);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = { status: 500, body: { ok: false, error: /password/i.test(message) ? "Паролата не беше приета." : `Грешка на сървъра: ${message}` } };
    }
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { ...CORS, "Content-Type": "application/json" } });
  });
}
