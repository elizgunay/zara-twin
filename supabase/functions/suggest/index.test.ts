import { describe, expect, it } from "vitest";
import { handle, numbersAreKnown, parseReply, parseRequest, parseSay, toBulgarian, userPrompt, type Deps } from "./index";

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
    expect(ok).toMatchObject({ status: 200, body: { ok: true, say: ["Минусът е, че иска равен под. Затова идваме на оглед безплатно."] } });
    expect((ok.body as { modelMs?: number }).modelMs).toBeGreaterThanOrEqual(0);
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
    expect(ok.body).toMatchObject({ ok: true, say: ["Разкажете ми повече за вечерите."], stage: 3 });
    expect(calls[0]).toContain("Продавачът току-що каза");
    expect(parseRequest({ ...body, lastSpeaker: "boss" })).toBeNull();
    expect(parseRequest(body)?.lastSpeaker).toBe("client");
    // Странна стъпка се пропуска, репликите остават.
    expect(parseReply('{"stage": "x", "say": ["Добре е."]}')).toEqual({ say: ["Добре е."] });
    expect(parseReply('{"stage": 99, "say": []}')).toEqual({ say: [] });
  });

  it("репликите от теста в Meet (22.10): без измислени числа и имена, без **, до 2 изречения", () => {
    const facts = "Сервитьорът T8 е 8 000 € без ДДС, носи 20 кг, минимален проход 55 см. Вторник в 15:00 или четвъртък в 11:00?";
    const raw = JSON.stringify({
      stage: 5,
      say: [
        "Малкият **T8** е за 8 000 € без ДДС. Ще ви спестим над 1 500 € месечно.",
        "Малкият **T8** носи до 20 кг и минава през 55 см. Той е за 8 000 € без ДДС. Вторник в 15:00 или четвъртък в 11:00? Ще ви хареса.",
      ],
    });
    const reply = parseReply(raw, facts);
    // Първият вариант има измислено число (1 500) и отпада; вторият остава, изчистен и до 2 изречения.
    expect(reply.say).toEqual(["Малкият T8 носи до 20 кг и минава през 55 см. Той е за 8 000 € без ДДС."]);
    expect(parseReply(JSON.stringify({ say: ["Здравейте, Никола. Аз съм Иван от Zara Robotics.", "Какво ви накара да се свържете с нас?"] }), facts).say)
      .toEqual(["Какво ви накара да се свържете с нас?"]);
    // Развален руски („Потомучето“, 22.10) отпада; нормалният вариант остава.
    expect(parseReply(JSON.stringify({ say: ["Потомучето ние ги внедряваме.", "Защото ние ги внедряваме."] }), facts).say).toEqual(["Защото ние ги внедряваме."]);
    expect(numbersAreKnown("около 20 € на месец", "носи 20 кг")).toBe(true); // числото е във фактите
    expect(numbersAreKnown("около 25 € на месец", "носи 20 кг")).toBe(false);
  });

  it("без разговор пише „(начало)“", () => {
    expect(userPrompt({ ...body, turns: [] } as never)).toContain("(начало)");
  });
});
