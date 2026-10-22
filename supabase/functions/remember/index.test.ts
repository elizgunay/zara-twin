import { describe, expect, it } from "vitest";
import { handle, parseFacts, parseRequest, transcript, type Deps } from "./index";

const ORG = "00000000-0000-4000-8000-00000000a000";
const CLIENT = "00000000-0000-4000-8000-0000000c0001";
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const SUPPORT = "00000000-0000-4000-8000-0000000000a4";
const lines = [
  { speaker: "seller", text: "Какъв тип заведение имате?" },
  { speaker: "client", text: "Снек бар в Свети Влас, има и тераса." },
  { speaker: "client", text: "Работната ръка е все по-трудно да се намери." },
  { speaker: "client", text: "Разгледах китайски модели за 3000 евро." },
  { speaker: "seller", text: "Ще ви пиша в март по вайбър." },
];
const body = { orgId: ORG, clientId: CLIENT, meetingCode: "abc-defg-hij", startedAt: 1_000, lines };

function deps(answer: string) {
  const inserted: unknown[] = [];
  const d: Deps = {
    caller: async (jwt) => (jwt === OWNER || jwt === SUPPORT ? { id: jwt } : null),
    roleIn: async (_org, user) => (user === OWNER ? "owner" : user === SUPPORT ? "support" : null),
    clientInOrg: async (client, org) => client === CLIENT && org === ORG,
    reportId: async () => "00000000-0000-4000-8000-0000000e0001",
    existingFacts: async () => ["Снек бар в Свети Влас."],
    insertFacts: async (rows) => void inserted.push(...rows),
    complete: async () => answer,
  };
  return { d, inserted };
}

describe("памет след среща (Edge Function remember)", () => {
  it("записва фактите като чакащи одобрение, с връзка към срещата", async () => {
    const { d, inserted } = deps(JSON.stringify({ facts: [
      { kind: "pain", fact: "Трудно намира персонал.", quote: "Работната ръка е все по-трудно да се намери." },
      { kind: "objection", fact: "Сравнява с китайски модели за 3000 евро.", quote: "китайски модели за 3000 евро" },
      { kind: "next_step", fact: "Обещахме да пишем в март по вайбър.", quote: "Ще ви пиша в март по вайбър." },
    ] }));
    const result = await handle(OWNER, body, d);
    expect(result).toEqual({ status: 200, body: { ok: true, proposed: 3 } });
    expect(inserted[0]).toMatchObject({ org_id: ORG, client_id: CLIENT, report_id: "00000000-0000-4000-8000-0000000e0001", kind: "pain" });
  });

  it("само собственик или продавач; клиентът е от фирмата", async () => {
    const { d, inserted } = deps('{"facts":[]}');
    expect((await handle(null, body, d)).status).toBe(401);
    expect((await handle(SUPPORT, body, d)).status).toBe(403);
    expect((await handle(OWNER, { ...body, clientId: "00000000-0000-4000-8000-0000000c0099" }, d)).status).toBe(404);
    expect(inserted).toHaveLength(0);
  });

  it("кратък разговор (под 3 реплики на клиента): нищо не се пита", async () => {
    let asked = false;
    const { d } = deps('{"facts":[]}');
    d.complete = async () => ((asked = true), '{"facts":[]}');
    const result = await handle(OWNER, { ...body, lines: lines.slice(0, 2) }, d);
    expect(result.body).toEqual({ ok: true, proposed: 0 });
    expect(asked).toBe(false);
  });

  it("защити: измислени числа, повторения, дълги факти, неверен цитат", () => {
    const said = transcript(lines as never);
    const facts = parseFacts(
      JSON.stringify({ facts: [
        { kind: "price", fact: "Бюджетът му е 5000 евро.", quote: "5000" }, // 5000 не е казано
        { kind: "venue", fact: "Снек бар в Свети Влас.", quote: "Снек бар" }, // вече го има
        { kind: "venue", fact: "Има тераса.", quote: "измислен цитат, който го няма" },
        { kind: "magic", fact: "x".repeat(250) }, // твърде дълъг
        { kind: "magic", fact: "Сравнява с **китайски** модели за 3000 евро." },
      ] }),
      said,
      ["Снек бар в Свети Влас."],
    );
    expect(facts).toEqual([
      { kind: "venue", fact: "Има тераса." }, // цитатът е махнат, фактът остава
      { kind: "other", fact: "Сравнява с китайски модели за 3000 евро." },
    ]);
    expect(parseFacts("не е JSON", said)).toEqual([]);
  });

  it("отказва странни заявки; дълъг разговор се съкращава отзад", () => {
    expect(parseRequest({ ...body, clientId: "Ресторант" })).toBeNull();
    expect(parseRequest({ ...body, lines: [{ speaker: "boss", text: "x" }] })).toBeNull();
    const long = Array.from({ length: 1500 }, (_, i) => ({ speaker: "client" as const, text: `Реплика номер ${i} от клиента.` }));
    const text = transcript(long);
    expect(text.length).toBeLessThanOrEqual(24_000);
    expect(text.endsWith("Реплика номер 1499 от клиента.")).toBe(true);
  });
});
