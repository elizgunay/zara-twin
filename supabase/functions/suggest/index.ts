// AI отговор по време на среща: когато клиентът пита нещо, за което пакетът няма готова карта,
// езиков модел (Mistral, сървър в ЕС, Р22) съставя 1–2 изречения САМО от фактите на фирмата.
// Работи на сървъра на Supabase (Edge Function): ключът за Mistral е тук (MISTRAL_API_KEY),
// никога в разширението. Пита само член на фирмата с вход от разширението (Опции → Табло).
//
// Качване: Supabase → Edge Functions → Deploy a new function → Via Editor → име suggest →
// поставете този файл → Deploy. Ключът: Edge Functions → Secrets → MISTRAL_API_KEY.
// Подробно: docs/setup/supabase.md, раздел 8.

export interface Turn {
  speaker: "client" | "seller";
  text: string;
}

export interface SuggestRequest {
  orgId: string;
  /** Фактите от пакета на фирмата (цени, гаранция, демо…), подготвени от разширението. */
  facts: string;
  /** Последните реплики преди въпроса, за контекст. */
  turns: Turn[];
  /** Изречението на клиента, на което търсим отговор. */
  question: string;
}

export type SuggestResponse = { ok: true; say: string[] } | { ok: false; error: string };

/** Каквото функцията иска отвън; в тестовете се подменя. */
export interface Deps {
  caller(jwt: string): Promise<{ id: string } | null>;
  isMember(orgId: string, userId: string): Promise<boolean>;
  /** Връща суровия текст от модела (JSON). */
  complete(system: string, user: string): Promise<string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FACTS = 12_000;
const MAX_TURNS = 6;
const MAX_TEXT = 400;
/** Репликите се четат на един поглед: до 2 изречения по 160 знака. */
const MAX_SAY = 2;
const MAX_SAY_LENGTH = 160;

export function parseRequest(value: unknown): SuggestRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.orgId !== "string" || !UUID.test(r.orgId)) return null;
  if (typeof r.facts !== "string" || r.facts.length === 0 || r.facts.length > MAX_FACTS) return null;
  if (typeof r.question !== "string" || r.question.trim().length < 3 || r.question.length > MAX_TEXT) return null;
  if (!Array.isArray(r.turns) || r.turns.length > MAX_TURNS) return null;
  const turns: Turn[] = [];
  for (const t of r.turns as unknown[]) {
    const turn = t as Record<string, unknown>;
    if ((turn?.speaker !== "client" && turn?.speaker !== "seller") || typeof turn.text !== "string" || turn.text.length > MAX_TEXT) return null;
    turns.push({ speaker: turn.speaker, text: turn.text });
  }
  return { orgId: r.orgId, facts: r.facts, turns, question: r.question.trim() };
}

export const SYSTEM_PROMPT = `Ти си Copilot на продавач по време на разговор с клиент. Продавачът чете подсказката на екрана и я казва дословно.

Правила:
- Отговаряй само на български, в 1 или 2 кратки изречения (до 160 знака всяко), готови за казване на глас, на „вие“.
- Ползвай САМО фактите на фирмата по-долу. Не измисляй цени, срокове, отстъпки, модели или условия.
- Ако нужният факт липсва: „Ще ви го уточня в офертата до утре в 12.“
- Бъди уверен и настоятелен: насочвай към безплатна демонстрация с конкретен ден и час.
- Без съвети към продавача, без „кажете му…“: само думите към клиента.
- Ако клиентът не пита и не възразява (поздрав, разказ, „добре“), върни празен списък.

Отговорът е JSON: {"say": ["изречение 1", "изречение 2"]} или {"say": []}.`;

export function userPrompt(request: SuggestRequest): string {
  const context = request.turns.map((t) => `${t.speaker === "client" ? "Клиент" : "Продавач"}: ${t.text}`).join("\n");
  return `Факти на фирмата:\n${request.facts}\n\nРазговорът досега:\n${context || "(начало)"}\n\nКлиентът току-що каза: „${request.question}“`;
}

/** Само кратки готови изречения: моделът понякога връща повече или по-дълго. */
export function parseSay(raw: string): string[] {
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
  const say = (value as { say?: unknown })?.say;
  if (!Array.isArray(say)) return [];
  return say
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0)
    .slice(0, MAX_SAY)
    .map((s) => (s.length <= MAX_SAY_LENGTH ? s : `${s.slice(0, MAX_SAY_LENGTH - 1).replace(/\s+\S*$/, "")}…`));
}

export async function handle(jwt: string | null, body: unknown, deps: Deps): Promise<{ status: number; body: SuggestResponse }> {
  const deny = (status: number, error: string) => ({ status, body: { ok: false as const, error } });
  if (!jwt) return deny(401, "Нужен е вход (Опции → Табло).");
  const caller = await deps.caller(jwt);
  if (!caller) return deny(401, "Входът е изтекъл. Влезте отново.");
  const request = parseRequest(body);
  if (!request) return deny(400, "Невалидна заявка.");
  // Ключът е на фирмата: ползват го само нейните хора.
  if (!(await deps.isMember(request.orgId, caller.id))) return deny(403, "Не сте член на тази фирма.");
  const raw = await deps.complete(SYSTEM_PROMPT, userPrompt(request));
  return { status: 200, body: { ok: true, say: parseSay(raw) } };
}

// ---------- Mistral и Supabase (изпълнява се само на сървъра, в Deno) ----------

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: globalThis.Request) => Promise<globalThis.Response>): void } | undefined;

/** Сървърът на Mistral в ЕС (данните се обработват в ЕС, Р22). */
export const MISTRAL_URL = "https://api.eu.mistral.ai/v1/chat/completions";
export const MISTRAL_MODEL = "mistral-small-latest";
const TIMEOUT_MS = 8_000;

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
    isMember: async (orgId, userId) => {
      const { data } = await db.from("members").select("role").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
      return Boolean(data);
    },
    complete: async (system, user) => {
      if (!mistralKey) throw new Error("Липсва MISTRAL_API_KEY в Secrets на Edge Functions.");
      const response = await fetch(MISTRAL_URL, {
        method: "POST",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${mistralKey}` },
        body: JSON.stringify({
          model: Deno!.env.get("MISTRAL_MODEL") || MISTRAL_MODEL,
          temperature: 0.2,
          max_tokens: 200,
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
    let result: { status: number; body: SuggestResponse };
    try {
      result = await handle(jwt, await req.json().catch(() => null), deps);
    } catch (error) {
      result = { status: 502, body: { ok: false, error: error instanceof Error ? error.message : String(error) } };
    }
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { ...CORS, "Content-Type": "application/json" } });
  });
}
