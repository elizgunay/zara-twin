import { describe, expect, it } from "vitest";
import { meetingToText, TranscriptStore, type KeyValueStore } from "./store";

const DAY = 24 * 60 * 60 * 1000;

function memory(): KeyValueStore {
  const data: Record<string, unknown> = {};
  return {
    get: async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

const meeting = (startedAt: number) => ({
  meetingCode: "abc-defg-hij",
  startedAt,
  lines: [
    { speaker: "counterpart" as const, text: "Колко струва T8?", at: startedAt + 1000 },
    { speaker: "owner" as const, text: "Ще ви пратя оферта.", at: startedAt + 5000 },
  ],
});

describe("TranscriptStore", () => {
  it("запазва и показва най-новите първи; същата среща се презаписва", async () => {
    let now = 10 * DAY;
    const store = new TranscriptStore(memory(), () => now);
    await store.save(meeting(1 * DAY));
    await store.save(meeting(2 * DAY));
    await store.save({ ...meeting(1 * DAY), lines: [...meeting(1 * DAY).lines, { speaker: "owner", text: "Още нещо.", at: 0 }] });
    const list = await store.list();
    expect(list.map((m) => m.startedAt)).toEqual([2 * DAY, 1 * DAY]);
    expect(list[1]!.lines).toHaveLength(3);
    now += 1;
  });

  it("изтрива записите след срока (30 дни по подразбиране)", async () => {
    let now = 0;
    const store = new TranscriptStore(memory(), () => now);
    await store.save(meeting(0));
    now = 29 * DAY;
    await store.save(meeting(29 * DAY));
    now = 31 * DAY;
    expect(await store.prune()).toBe(1);
    expect((await store.list()).map((m) => m.startedAt)).toEqual([29 * DAY]);
  });

  it("срокът се сменя само на позволени стойности и веднага чисти", async () => {
    let now = 0;
    const store = new TranscriptStore(memory(), () => now);
    await store.save(meeting(0));
    now = 8 * DAY;
    await store.setRetentionDays(7);
    expect(await store.list()).toEqual([]);
    await expect(store.setRetentionDays(5)).rejects.toThrow(/Непозволен/);
  });

  it("изтрива един запис или всички", async () => {
    const store = new TranscriptStore(memory(), () => 0);
    const first = await store.save(meeting(1));
    await store.save(meeting(2));
    await store.remove(first.id);
    expect(await store.list()).toHaveLength(1);
    await store.removeAll();
    expect(await store.list()).toEqual([]);
  });

  it("текстовият файл съдържа кой какво е казал", async () => {
    const store = new TranscriptStore(memory(), () => 0);
    const saved = await store.save(meeting(0));
    const text = meetingToText(saved);
    expect(text).toContain("Среща: abc-defg-hij");
    expect(text).toMatch(/Събеседник: Колко струва T8\?/);
    expect(text).toMatch(/Вие: Ще ви пратя оферта\./);
  });
});
