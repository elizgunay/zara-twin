import { h } from "./dom";
import type { ReportRow } from "./reports";
import { reportCharts, reportList, reportTiles, type Context } from "./screens";

// Примерни (измислени) срещи за преглед на екрана „Срещи“ без вход. Само за разработка.
const day = 24 * 60 * 60 * 1000;
const think = { id: "think", label: "„Трябва да си помисля“", atMs: 12 * 60_000 + 20_000, again: false };
const price = { id: "price", label: "Възражение: цена", atMs: 15 * 60_000, again: false };
const rows: ReportRow[] = Array.from({ length: 14 }, (_, i) => {
  const start = Date.now() - i * 2.3 * day;
  const good = i % 3 !== 1;
  return {
    id: String(i), user_id: i % 4 === 0 ? "u2" : "me", meeting_code: "abc-defg-hij", is_test: i === 0,
    started_at: new Date(start).toISOString(), ended_at: new Date(start + (20 + i) * 60_000).toISOString(),
    owner_ms: good ? 9 * 60_000 : 16 * 60_000, counterpart_ms: good ? 8 * 60_000 : 5 * 60_000, monologues: good ? 0 : 2, hints: 6 + i,
    score: good ? Math.min(10, 6 + (i % 5)) : 2 + (i % 3),
    objections: good ? [think, price].slice(0, 1 + (i % 2)) : [think, { ...think, atMs: 20 * 60_000, again: true }],
    products: i % 2 ? ["Keenon Dinerbot T9"] : ["Keenon Kleenbot C40S", "Keenon Kleenbot C55"],
    next_step: good ? { label: "четвъртък, 10:00", atMs: 22 * 60_000 } : null,
    notes: good ? ["Следваща стъпка: четвъртък, 10:00.", "Говорихте 53% от времето: клиентът имаше място да говори."]
      : ["Няма уговорен ден и час за следваща стъпка.", "Говорихте 76% от времето: клиентът почти не се изказа."],
  };
});
const ctx = { org: { orgId: "x", orgName: "Zara Robotics", role: "owner", retentionDays: 30 }, userId: "me", email: "", refresh: () => {} } as Context;
const labels = new Map([["me", "Вие"], ["u2", "Продавач 1"]]);

document.getElementById("app")!.replaceChildren(h("div", { class: "wrap" },
  h("header", { class: "top" }, h("div", { class: "meta" }, h("span", { class: "eyebrow" }, "Преглед с примерни данни"), h("h1", {}, "Срещи"))),
  reportTiles(rows), reportCharts(rows), reportList(rows, ctx, labels)));
