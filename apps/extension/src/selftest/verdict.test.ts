import { describe, expect, it } from "vitest";
import { expectedLatencySeconds, verdictFor } from "./verdict";

describe("присъда от теста на компютъра", () => {
  it("класифицира по скорост спрямо говора (RTF)", () => {
    expect(verdictFor(0.1)).toBe("suitable");
    expect(verdictFor(0.25)).toBe("suitable");
    expect(verdictFor(0.4)).toBe("borderline");
    expect(verdictFor(3.0)).toBe("unsuitable"); // слабият лаптоп от измерванията
  });

  it("смята очакваното закъснение за изказване от 5 s", () => {
    expect(expectedLatencySeconds(0.25)).toBe(1.9);
    expect(expectedLatencySeconds(3.0)).toBe(15.6);
  });
});
