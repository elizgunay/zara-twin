// Памет след среща (Фаза 2, Р31/Р33): в края на среща с избран клиент разширението праща текста на
// разговора, а езиков модел (Mistral, сървър в ЕС, Р22) изважда кратки факти за клиента. Те се
// записват като „чакат одобрение“: в паметта влиза само одобреното в таблото (Р33).
// Ключът за Mistral е тук (MISTRAL_API_KEY), никога в разширението. Пита само собственик или
// продавач от фирмата на клиента.
//
// Качване: Supabase → Edge Functions → Deploy a new function → Via Editor → име remember →
// поставете този файл → Deploy (Verify JWT изключено, както при suggest). Ползва същите Secrets.
// Подробно: docs/setup/supabase.md, раздел 10.

export type FactKind = "venue" | "pain" | "objection" | "price" | "decision" | "next_step" | "other";
export const FACT_KINDS: readonly FactKind[] = ["venue", "pain", "objection", "price", "decision", "next_step", "other"];

export interface RememberRequest {
  orgId: string;
  clientId: string;
  meetingCode: string;
  /** Началото на срещата (ms): по него се намира обобщението ѝ в базата. */
  startedAt: number;
  lines: { speaker: "client" | "seller"; text: string }[];
}

export interface Fact {
  kind: FactKind;
  fact: string;
  quote?: string;
}

export type RememberResponse = { ok: true; proposed: number } | { ok: false; error: string };

/** Каквото функцията иска отвън; в тестовете се подменя. */
export interface Deps {
  caller(jwt: string): Promise<{ id: string } | null>;
  /** Ролята на човека във фирмата (owner, seller, …) или null. */
  roleIn(orgId: string, userId: string): Promise<string | null>;
  /** Клиентът е от тази фирма. */
  clientInOrg(clientId: string, orgId: string): Promise<boolean>;
  /** Обобщението на срещата в базата (за връзката факт → среща), ако вече е записано. */
  reportId(orgId: string, userId: string, meetingCode: string, startedAt: number): Promise<string | null>;
  /** Вече записаните факти за клиента (за да не се повтарят). */
  existingFacts(clientId: string): Promise<string[]>;
  insertFacts(rows: { org_id: string; client_id: string; report_id: string | null; kind: FactKind; fact: string; quote: string | null }[]): Promise<void>;
  complete(system: string, user: string): Promise<string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LINES = 2_000;
const MAX_LINE = 2_000;
/** До толкова знака разговор отиват към модела (около 30 минути): последните, ако е по-дълъг. */
const MAX_TRANSCRIPT = 24_000;
const MAX_FACTS = 8;
const MAX_FACT = 200;
const MAX_QUOTE = 200;
/** По-кратък разговор няма какво да запомни. */
const MIN_CLIENT_LINES = 3;

export function parseRequest(value: unknown): RememberRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.orgId !== "string" || !UUID.test(r.orgId)) return null;
  if (typeof r.clientId !== "string" || !UUID.test(r.clientId)) return null;
  if (typeof r.meetingCode !== "string" || r.meetingCode.length === 0 || r.meetingCode.length > 64) return null;
  if (typeof r.startedAt !== "number" || !Number.isFinite(r.startedAt)) return null;
  if (!Array.isArray(r.lines) || r.lines.length > MAX_LINES) return null;
  const lines: RememberRequest["lines"] = [];
  for (const l of r.lines as unknown[]) {
    const line = l as Record<string, unknown>;
    if ((line?.speaker !== "client" && line?.speaker !== "seller") || typeof line.text !== "string" || line.text.length > MAX_LINE) return null;
    lines.push({ speaker: line.speaker, text: line.text });
  }
  return { orgId: r.orgId, clientId: r.clientId, meetingCode: r.meetingCode, startedAt: r.startedAt, lines };
}

export const SYSTEM_PROMPT = `Ти си помощник на продавач. Прочети разговора с клиента и запиши кратки факти за КЛИЕНТА, които ще помогнат на следващата среща с него.

Какво да запишеш (само ако е казано в разговора):
- venue: обектът на клиента (вид, размер, зали, под, етажи, тераса, град).
- pain: болката (липса на персонал, пикови часове, бавно обслужване…).
- objection: възраженията му (скъпо, ще помисли, сравнява с друг…).
- price: казани цени, бюджет, вноски, отстъпки, за които е питал.
- decision: кой решава (съдружник, собственик) и кога ще реши.
- next_step: какво е обещано и кога (оферта, демо, обаждане, ден и час).
- other: друго важно за продажбата.

Правила:
- Най-много 8 факта, всеки 1 кратко изречение на български (до 200 знака), без да се повтарят.
- САМО казаното в разговора. Не измисляй числа, имена, градове или обещания. Ако нещо не е ясно, не го пиши.
- За всеки факт: "quote" е дословен откъс от думите в разговора (до 200 знака), на който се основава.
- Без поздрави, без общи приказки, без факти за продавача или за нашата фирма.

Отговорът е JSON: {"facts": [{"kind": "venue", "fact": "…", "quote": "…"}]} или {"facts": []}.`;

/** Разговорът като текст за модела; ако е дълъг, последната част (там са решенията). */
export function transcript(lines: RememberRequest["lines"]): string {
  const text = lines.map((l) => `${l.speaker === "client" ? "Клиент" : "Продавач"}: ${l.text}`).join("\n");
  return text.length <= MAX_TRANSCRIPT ? text : text.slice(text.length - MAX_TRANSCRIPT);
}

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const numbersIn = (text: string) => (text.match(/\d[\d\s.,:]*\d|\d/g) ?? []).map((n) => n.replace(/[\s.,]/g, ""));

/**
 * Фактите от модела, с защити: известен вид, кратки, без числа извън разговора, цитатът
 * наистина е от разговора (иначе се маха само цитатът), без повторения.
 */
export function parseFacts(raw: string, said: string, existing: string[] = []): Fact[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    const match = /\{[\s\S]*\}/.exec(raw);
    if (!match) return [];
    try {
      value = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
  const items = (value as { facts?: unknown })?.facts;
  if (!Array.isArray(items)) return [];
  const saidNorm = normalize(said);
  const saidNumbers = new Set(numbersIn(said));
  const seen = new Set(existing.map(normalize));
  const out: Fact[] = [];
  for (const item of items) {
    if (out.length >= MAX_FACTS) break;
    const r = item as Record<string, unknown>;
    const kind = FACT_KINDS.includes(r?.kind as FactKind) ? (r.kind as FactKind) : "other";
    const fact = typeof r?.fact === "string" ? r.fact.replace(/\*\*|[*#`]/g, "").replace(/\s+/g, " ").trim() : "";
    if (fact.length === 0 || fact.length > MAX_FACT) continue;
    // Измислено число (сума, процент, дата), което го няма в разговора.
    if (!numbersIn(fact).every((n) => saidNumbers.has(n) || n.length <= 1)) continue;
    if (seen.has(normalize(fact))) continue;
    seen.add(normalize(fact));
    const quote = typeof r.quote === "string" ? r.quote.replace(/\s+/g, " ").trim().slice(0, MAX_QUOTE) : "";
    const quoteIsReal = quote.length >= 3 && saidNorm.includes(normalize(quote));
    out.push(quoteIsReal ? { kind, fact, quote } : { kind, fact });
  }
  return out;
}

export async function handle(jwt: string | null, body: unknown, deps: Deps): Promise<{ status: number; body: RememberResponse }> {
  const deny = (status: number, error: string) => ({ status, body: { ok: false as const, error } });
  if (!jwt) return deny(401, "Нужен е вход (Опции → Табло).");
  const caller = await deps.caller(jwt);
  if (!caller) return deny(401, "Входът е изтекъл. Влезте отново.");
  const request = parseRequest(body);
  if (!request) return deny(400, "Невалидна заявка.");
  const role = await deps.roleIn(request.orgId, caller.id);
  if (role !== "owner" && role !== "seller") return deny(403, "Само собственик или продавач от фирмата.");
  if (!(await deps.clientInOrg(request.clientId, request.orgId))) return deny(404, "Няма такъв клиент във фирмата.");
  if (request.lines.filter((l) => l.speaker === "client").length < MIN_CLIENT_LINES) return { status: 200, body: { ok: true, proposed: 0 } };

  const said = transcript(request.lines);
  const raw = await deps.complete(SYSTEM_PROMPT, `Разговорът:\n${said}`);
  const facts = parseFacts(raw, said, await deps.existingFacts(request.clientId));
  if (facts.length > 0) {
    const reportId = await deps.reportId(request.orgId, caller.id, request.meetingCode, request.startedAt);
    await deps.insertFacts(
      facts.map((f) => ({ org_id: request.orgId, client_id: request.clientId, report_id: reportId, kind: f.kind, fact: f.fact, quote: f.quote ?? null })),
    );
  }
  return { status: 200, body: { ok: true, proposed: facts.length } };
}

// ---------- Mistral и Supabase (изпълнява се само на сървъра, в Deno) ----------

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: globalThis.Request) => Promise<globalThis.Response>): void } | undefined;

/** Сървърът на Mistral в ЕС (Р22). */
export const MISTRAL_URL = "https://api.eu.mistral.ai/v1/chat/completions";
// Веднъж на среща, точността е по-важна от скоростта: по-големият модел (0,5 заявки/s стигат).
export const MEMORY_MODEL = "ministral-14b-2512";
const TIMEOUT_MS = 30_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  const mistralKey = Deno.env.get("MISTRAL_API_KEY");
  if (!key) throw new Error("Липсва главният ключ на проекта (SUPABASE_SERVICE_ROLE_KEY или SUPABASE_SECRET_KEYS).");
  const db = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const deps: Deps = {
    caller: async (jwt) => (await db.auth.getUser(jwt)).data.user ?? null,
    roleIn: async (orgId, userId) => {
      const { data } = await db.from("members").select("role").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
      return (data?.role as string | undefined) ?? null;
    },
    clientInOrg: async (clientId, orgId) => {
      const { data } = await db.from("clients").select("id").eq("id", clientId).eq("org_id", orgId).maybeSingle();
      return Boolean(data);
    },
    reportId: async (orgId, userId, meetingCode, startedAt) => {
      const { data } = await db
        .from("meeting_reports")
        .select("id")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .eq("meeting_code", meetingCode)
        .eq("started_at", new Date(startedAt).toISOString())
        .maybeSingle();
      return (data?.id as string | undefined) ?? null;
    },
    existingFacts: async (clientId) => {
      const { data } = await db.from("client_facts").select("fact").eq("client_id", clientId).neq("status", "rejected").limit(200);
      return (data ?? []).map((row: { fact: string }) => row.fact);
    },
    insertFacts: async (rows) => {
      const { error } = await db.from("client_facts").insert(rows);
      if (error) throw new Error(error.message);
    },
    complete: async (system, user) => {
      if (!mistralKey) throw new Error("Липсва MISTRAL_API_KEY в Secrets на Edge Functions.");
      const response = await fetch(MISTRAL_URL, {
        method: "POST",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${mistralKey}` },
        body: JSON.stringify({
          model: Deno!.env.get("MISTRAL_MEMORY_MODEL") || MEMORY_MODEL,
          temperature: 0.1,
          max_tokens: 1_200,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Mistral: ${response.status} ${(await response.text()).slice(0, 200)}`);
      const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? "";
    },
  };

  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    let result: { status: number; body: RememberResponse };
    try {
      result = await handle(jwt, await req.json().catch(() => null), deps);
    } catch (error) {
      result = { status: 502, body: { ok: false, error: error instanceof Error ? error.message : String(error) } };
    }
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { ...CORS, "Content-Type": "application/json" } });
  });
}
