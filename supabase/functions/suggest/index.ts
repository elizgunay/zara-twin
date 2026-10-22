// AI реплика по време на среща: след всяко изречение (на клиента или на продавача) и кратка пауза,
// когато пакетът няма готова карта, езиков модел (Mistral, сървър в ЕС, Р22) води разговора по
// сценария: казва на коя стъпка е и дава 1–2 изречения САМО от фактите на фирмата.
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
  /** Последното изречение в разговора, след което търсим следващата реплика на продавача. */
  question: string;
  /** Кой го каза: клиентът (отговор) или самият продавач (следващата стъпка). По подразбиране клиентът. */
  lastSpeaker: "client" | "seller";
}

/** stage: на коя стъпка от сценария е разговорът (1 = първата), ако моделът я е определил. */
/** modelMs: колко време отне моделът (за измерване къде отива времето). */
export type SuggestResponse = { ok: true; say: string[]; stage?: number; modelMs?: number } | { ok: false; error: string };

/** Каквото функцията иска отвън; в тестовете се подменя. */
export interface Deps {
  caller(jwt: string): Promise<{ id: string } | null>;
  isMember(orgId: string, userId: string): Promise<boolean>;
  /** Връща суровия текст от модела (JSON). */
  complete(system: string, user: string): Promise<string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FACTS = 16_000;
const MAX_TURNS = 6;
const MAX_TEXT = 400;
/** До 2 реплики. Не се режат по средата: само прекалено дълга спира в края на цяло изречение. */
const MAX_SAY = 2;
const MAX_SAY_LENGTH = 400;

/**
 * Моделът понякога смесва руски думи („потому“). Честите се сменят с българските; реплика с
 * чисто руски букви (ы, э, ё) се пропуска.
 */
const RUSSIAN: [string, string][] = [
  ["потому что", "защото"], ["поэтому", "затова"], ["потому", "затова"], ["сейчас", "сега"], ["очень", "много"],
  ["конечно", "разбира се"], ["тоже", "също"], ["только", "само"], ["если", "ако"], ["который", "който"],
  ["которые", "които"], ["нужно", "трябва"], ["можно", "може"], ["хорошо", "добре"], ["спасибо", "благодаря"],
  ["здесь", "тук"], ["всегда", "винаги"], ["вопрос", "въпрос"], ["сегодня", "днес"], ["завтра", "утре"],
];
const RUSSIAN_LETTERS = /[ыэё]/iu;
/** Слепени или развалени руски думи, които замяната не хваща („Потомучето“): вариантът отпада. */
const RUSSIAN_STEMS = /потом|поэт|сейч|очен|конеч|которы|(?<!\p{L})да ли(?!\p{L})/iu;

export function toBulgarian(text: string): string {
  let out = text;
  for (const [ru, bg] of RUSSIAN) {
    out = out.replace(new RegExp(`(?<!\\p{L})${ru}(?!\\p{L})`, "giu"), (m) => (m[0] === m[0]!.toUpperCase() ? bg[0]!.toUpperCase() + bg.slice(1) : bg));
  }
  return out;
}

/** Над лимита: до края на последното цяло изречение, без „…“. */
function wholeSentences(text: string): string {
  if (text.length <= MAX_SAY_LENGTH) return text;
  const cut = text.slice(0, MAX_SAY_LENGTH);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > 0 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "");
}

/** Репликата се казва на глас: без **удебеляване**, # и звездички от модела. */
export function plainText(text: string): string {
  return text.replace(/\*\*|__|[*#`]/g, "").replace(/\s+/g, " ").trim();
}

/** Най-много 2 изречения: моделът понякога пише по 4 (тест в Meet, 22.10.2026). */
export function firstSentences(text: string, max = 2): string {
  const parts = text.match(/[^.!?]+[.!?]+["“”»]?|[^.!?]+$/g) ?? [text];
  return parts.slice(0, max).join("").trim();
}

/** Представяне с име („Аз съм Иван“, „Казвам се Мария“): моделът го измисля. */
const INVENTED_NAME = /(?<!\p{L})(?:[Аа]з съм|[Кк]азвам се|[Ии]мето ми е)\s+\p{Lu}\p{Ll}+/u;

/** Числата като низ от цифри: „8 000 €“ и „8000“ са едно и също. */
const numbersIn = (text: string) => (text.match(/\d[\d\s.,:]*\d|\d/g) ?? []).map((n) => n.replace(/[\s.,]/g, ""));

/**
 * Защита срещу измислени числа (видяхме „спестявате над 1 500 € месечно“): всяко число в репликата
 * трябва да го има във фактите или в разговора. Иначе вариантът отпада.
 */
export function numbersAreKnown(text: string, known: string): boolean {
  const allowed = new Set(numbersIn(known));
  return numbersIn(text).every((n) => allowed.has(n) || n.length <= 1);
}

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
  if (r.lastSpeaker !== undefined && r.lastSpeaker !== "client" && r.lastSpeaker !== "seller") return null;
  return { orgId: r.orgId, facts: r.facts, turns, question: r.question.trim(), lastSpeaker: r.lastSpeaker ?? "client" };
}

export const SYSTEM_PROMPT = `Ти си Copilot на продавач по време на разговор с клиент. Продавачът чете подсказката на екрана и я казва дословно.

Ти водиш разговора по сценария: винаги знаеш на коя стъпка е и какво трябва да каже продавачът сега.

Ако последен е говорил клиентът:
- Пита нещо: ПЪРВО отговори директно на въпроса от фактите (не отговаряй с въпрос). Едва след отговора може кратък въпрос към следващата стъпка.
- Разказва за себе си или за обекта си: кратко потвърждение и следващият въпрос по сценария.
- Колебае се или възразява: една реплика, която връща към демонстрация с ден и час.
- Само поздрав, „добре“, „аха“ или неразбираем откъс: продължи разговора със следващия въпрос по сценария.

Ако последен е говорил продавачът и настъпи пауза:
- Предложи следващата му реплика по сценария: следващия въпрос или следващата стъпка. Ако е пропуснал стъпка (напр. цена без обобщение), върни го към нея.
- Ако продавачът току-що е задал въпрос и чака отговор: празен списък (не го прекъсвай).

Правила:
- Само на правилен български, на „вие“, готово за казване на глас. Никакви руски думи („потому“, „сейчас“, „очень“): само български („затова“, „сега“, „много“).
- Всяка реплика е 1–2 кратки, завършени изречения (до около 160 знака). Без удебеляване, звездички и списъци.
- Не се представяй и не измисляй имена: не знаеш как се казва продавачът. Не измисляй числа: суми, спестявания, разходи, проценти, срокове. Число може само ако го има във фактите или в разговора.
- Върни 2 варианта: първият е най-добрият, вторият е различен подход (напр. въпрос вместо твърдение).
- Ползвай САМО фактите на фирмата. Не измисляй цени, срокове, отстъпки, модели или условия. Ако факт липсва: „Ще ви го уточня в офертата до утре в 12.“
- Уверено и настоятелно, по правилата на сценария. Без съвети към продавача („кажете му…“): само думите към клиента.

Отговорът е JSON: {"stage": номер на стъпката от сценария, на която е разговорът (1, 2, …), "say": ["вариант 1", "вариант 2"]} или {"stage": номер, "say": []}.`;

export function userPrompt(request: SuggestRequest): string {
  const context = request.turns.map((t) => `${t.speaker === "client" ? "Клиент" : "Продавач"}: ${t.text}`).join("\n");
  const who = request.lastSpeaker === "seller" ? "Продавачът току-що каза" : "Клиентът току-що каза";
  return `Факти на фирмата:\n${request.facts}\n\nРазговорът досега:\n${context || "(начало)"}\n\n${who}: „${request.question}“`;
}

/**
 * Отговорът на модела: репликите (кратки, на български) и стъпката от сценария (1–20), ако я има.
 * known: фактите и разговорът; реплика с число, което го няма там, отпада.
 */
export function parseReply(raw: string, known?: string): { say: string[]; stage?: number } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    const match = /\{[\s\S]*\}/.exec(raw);
    if (!match) return { say: [] };
    try {
      value = JSON.parse(match[0]);
    } catch {
      return { say: [] };
    }
  }
  const reply = (value ?? {}) as { say?: unknown; stage?: unknown };
  const stage = Number(reply.stage);
  const say = Array.isArray(reply.say)
    ? reply.say
        .filter((s): s is string => typeof s === "string")
        .map((s) => plainText(s))
        .filter((s) => s.length > 0 && !RUSSIAN_LETTERS.test(s) && !RUSSIAN_STEMS.test(toBulgarian(s)))
        .filter((s) => known === undefined || numbersAreKnown(s, known))
        // Моделът не знае името на продавача: „Аз съм Иван…“ отпада.
        .filter((s) => !INVENTED_NAME.test(s))
        .map((s) => wholeSentences(firstSentences(toBulgarian(s))))
        .slice(0, MAX_SAY)
    : [];
  return Number.isInteger(stage) && stage >= 1 && stage <= 20 ? { say, stage } : { say };
}

export function parseSay(raw: string): string[] {
  return parseReply(raw).say;
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
  const started = Date.now();
  const raw = await deps.complete(SYSTEM_PROMPT, userPrompt(request));
  const known = [request.facts, request.question, ...request.turns.map((t) => t.text)].join("\n");
  return { status: 200, body: { ok: true, ...parseReply(raw, known), modelMs: Date.now() - started } };
}

// ---------- Mistral и Supabase (изпълнява се само на сървъра, в Deno) ----------

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: globalThis.Request) => Promise<globalThis.Response>): void } | undefined;

/** Сървърът на Mistral в ЕС (данните се обработват в ЕС, Р22). */
export const MISTRAL_URL = "https://api.eu.mistral.ai/v1/chat/completions";
// mistral-small е с тесен безплатен лимит (20 000 токена/мин, видяхме 429). ministral-8b е по-бърз
// и приема 3 заявки/s (14b: 0,5/s): нужно, когато Copilot води разговора след всяка пауза.
export const MISTRAL_MODEL = "ministral-8b-2512";
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
          // Репликите са кратки: по-нисък таван = по-бърз отговор (400 знака ≈ 150–200 токена).
          max_tokens: 250,
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
