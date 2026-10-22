import { describe, expect, it } from "vitest";
import { handle, parseReply, parseRequest, parseSay, toBulgarian, userPrompt, type Deps } from "./index";

const ORG = "00000000-0000-4000-8000-00000000a000";
const OTHER = "00000000-0000-4000-8000-00000000b000";
const USER = "00000000-0000-4000-8000-0000000000a1";
const body = { orgId: ORG, facts: "Гаранция 24 месеца.", turns: [{ speaker: "client", text: "Здравейте" }], question: "Какви са минусите?" };

function deps(answer = '{"say":["Минусът е, че иска равен под. Затова идваме на оглед безплатно."]}') {
  const calls: string[] = [];
  const d: Deps = {
    caller: async (jwt) => (jwt === USER ? { id: USER } : null),
    isMember: async (org, user) => org === ORG && user === USER,
    complete: async (_system, user) => {
      calls.push(user);
      return answer;
    },
  };
  return { d, calls };
}

describe("AI отговор (Edge Function suggest)", () => {
  it("само член на фирмата с вход", async () => {
    const { d, calls } = deps();
    expect((await handle(null, body, d)).status).toBe(401);
    expect((await handle("чужд", body, d)).status).toBe(401);
    expect((await handle(USER, { ...body, orgId: OTHER }, d)).status).toBe(403);
    expect(calls).toHaveLength(0); // без достъп моделът не се пита
    const ok = await handle(USER, body, d);
    expect(ok).toEqual({ status: 200, body: { ok: true, say: ["Минусът е, че иска равен под. Затова идваме на оглед безплатно."] } });
  });

  it("моделът получава фактите, разговора и въпроса", async () => {
    const { d, calls } = deps();
    await handle(USER, body, d);
    expect(calls[0]).toContain("Гаранция 24 месеца.");
    expect(calls[0]).toContain("Клиент: Здравейте");
    expect(calls[0]).toContain("„Какви са минусите?“");
  });

  it("отказва странни заявки", () => {
    expect(parseRequest({ ...body, question: "" })).toBeNull();
    expect(parseRequest({ ...body, turns: Array(7).fill({ speaker: "client", text: "а" }) })).toBeNull();
    expect(parseRequest({ ...body, turns: [{ speaker: "boss", text: "а" }] })).toBeNull();
    expect(parseRequest({ ...body, facts: "x".repeat(20_000) })).toBeNull();
  });

  it("до 2 реплики, цели, без „…“", () => {
    expect(parseSay('{"say":[]}')).toEqual([]);
    expect(parseSay("не е JSON")).toEqual([]);
    expect(parseSay('Ето: {"say":["Едно.","Две.","Три."]}')).toEqual(["Едно.", "Две."]);
    // 200 знака: остава цяла (преди се режеше на 160 с „…“).
    const medium = "Роботът поема разнасянето на чиниите, а вашите сервитьори остават при гостите и продават повече. Идваме на безплатна демонстрация при вас, във вторник в 15:00.";
    expect(parseSay(JSON.stringify({ say: [medium] }))).toEqual([medium]);
    // Прекалено дълга: спира в края на цяло изречение.
    const long = parseSay(JSON.stringify({ say: ["Първо изречение е тук. ".repeat(30)] }))[0]!;
    expect(long.length).toBeLessThanOrEqual(400);
    expect(long.endsWith(".")).toBe(true);
    expect(long).not.toContain("…");
  });

  it("руските думи стават български, руски букви – вариантът отпада", () => {
    expect(toBulgarian("Потому что е удобно, сейчас ще ви кажа.")).toBe("Защото е удобно, сега ще ви кажа.");
    expect(toBulgarian("Ние сме тук потому вие питате")).toBe("Ние сме тук затова вие питате");
    expect(toBulgarian("Потребител")).toBe("Потребител"); // не пипа части от думи
    expect(parseSay('{"say":["Это очень хорошо.","Добре е."]}')).toEqual(["Добре е."]);
  });

  it("отговаря и на изказване (следващата стъпка), с 2 варианта", async () => {
    const { SYSTEM_PROMPT } = await import("./index");
    expect(SYSTEM_PROMPT).toContain("Разказва за себе си");
    expect(SYSTEM_PROMPT).toContain("Върни 2 варианта");
  });

  it("води разговора: стъпката от сценария и реплика и след продавача", async () => {
    const { d, calls } = deps('{"stage": 3, "say": ["Разкажете ми повече за вечерите."]}');
    const ok = await handle(USER, { ...body, question: "Ще ви задам няколко въпроса.", lastSpeaker: "seller" }, d);
    expect(ok.body).toEqual({ ok: true, say: ["Разкажете ми повече за вечерите."], stage: 3 });
    expect(calls[0]).toContain("Продавачът току-що каза");
    expect(parseRequest({ ...body, lastSpeaker: "boss" })).toBeNull();
    expect(parseRequest(body)?.lastSpeaker).toBe("client");
    // Странна стъпка се пропуска, репликите остават.
    expect(parseReply('{"stage": "x", "say": ["Добре е."]}')).toEqual({ say: ["Добре е."] });
    expect(parseReply('{"stage": 99, "say": []}')).toEqual({ say: [] });
  });

  it("без разговор пише „(начало)“", () => {
    expect(userPrompt({ ...body, turns: [] } as never)).toContain("(начало)");
  });
});
