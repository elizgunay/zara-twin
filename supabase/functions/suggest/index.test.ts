import { describe, expect, it } from "vitest";
import { handle, parseRequest, parseSay, userPrompt, type Deps } from "./index";

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

  it("само до 2 кратки изречения, а без въпрос – нищо", () => {
    expect(parseSay('{"say":[]}')).toEqual([]);
    expect(parseSay("не е JSON")).toEqual([]);
    expect(parseSay('Ето: {"say":["Едно.","Две.","Три."]}')).toEqual(["Едно.", "Две."]);
    const long = parseSay(JSON.stringify({ say: ["дума ".repeat(60)] }))[0]!;
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("…")).toBe(true);
  });

  it("без разговор пише „(начало)“", () => {
    expect(userPrompt({ ...body, turns: [] } as never)).toContain("(начало)");
  });
});
