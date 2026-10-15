import { describe, expect, it } from "vitest";
import { summarizeLatency } from "./latency";

describe("summarizeLatency", () => {
  it("връща p50, p90 и максимум", () => {
    const samples = [900, 100, 800, 200, 700, 300, 600, 400, 500, 1000];
    expect(summarizeLatency(samples)).toEqual({ count: 10, p50Ms: 500, p90Ms: 900, maxMs: 1000 });
  });

  it("работи с едно измерване", () => {
    expect(summarizeLatency([1234])).toEqual({ count: 1, p50Ms: 1234, p90Ms: 1234, maxMs: 1234 });
  });

  it("отказва празен списък", () => {
    expect(() => summarizeLatency([])).toThrow();
  });
});
