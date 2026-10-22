import { validatePack } from "@zara-twin/knowledge";
import { describe, expect, it } from "vitest";
import rawPack from "../../../knowledge-packs/zara-robotics/pack.json";
import { AnswerDetector } from "./answers";

const pack = validatePack(rawPack);
const client = (d: AnswerDetector, text: string) => d.onSegment({ speaker: "counterpart", text });

describe("AnswerDetector", () => {
  it("на въпрос на клиента дава готово изречение от фактите на бизнеса", () => {
    const d = new AnswerDetector(pack);
    const [hint] = client(d, "А колко е гаранцията?");
    expect(hint).toMatchObject({ key: "answer:warranty", kind: "answer", title: "Гаранция" });
    expect(hint!.say![0]).toBe("Гаранцията е 2 години пълна, включително батерията, а сервизът е тук, в България.");
  });

  it("разпознава най-честите въпроси", () => {
    const cases: [string, string][] = [
      ["Работи ли с асансьора?", "answer:elevator"],
      ["Може ли да го вземем под наем?", "answer:rent"],
      ["Трудно ли се работи с него?", "answer:training"],
      ["Колко време отнема внедряването?", "answer:rollout"],
      ["Безопасно ли е, като има деца в ресторанта?", "answer:safety"],
      ["Свързва ли се с касата?", "answer:integration"],
      ["Кога може да доставите?", "answer:delivery"],
      ["Кой го поправя, ако спре?", "answer:service"],
    ];
    for (const [text, key] of cases) expect(client(new AnswerDetector(pack), text).map((h) => h.key), text).toContain(key);
  });

  it("мълчи, когато продавачът сам казва думата, и не се повтаря 3 минути", () => {
    let now = 0;
    const d = new AnswerDetector(pack, { now: () => now });
    expect(d.onSegment({ speaker: "owner", text: "Гаранцията е 24 месеца." })).toEqual([]);
    expect(client(d, "А гаранцията?")).toHaveLength(1);
    now += 60_000;
    expect(client(d, "Пак за гаранцията?")).toHaveLength(0);
  });

  it("без отговори в пакета не прави нищо", () => {
    expect(client(new AnswerDetector({ ...pack, answers: [] }), "Колко е гаранцията?")).toEqual([]);
  });
});
