import { describe, expect, it } from "vitest";
import { liveLatencySeconds, verdictForLatency } from "./verdict";

describe("присъда от теста на компютъра", () => {
  it("закъснението на живо = пауза 0,6 s + разпознаване на изказването", () => {
    expect(liveLatencySeconds(1.0)).toBe(1.6);
    expect(liveLatencySeconds(2.84)).toBe(3.4);
  });

  it("класифицира по закъснението (цел под 2 s)", () => {
    expect(verdictForLatency(1.6)).toBe("suitable");
    expect(verdictForLatency(2)).toBe("suitable");
    expect(verdictForLatency(2.7)).toBe("borderline");
    expect(verdictForLatency(8.7)).toBe("unsuitable");
  });
});
