import { describe, expect, it } from "vitest";
import { isSttChoice, pickBest, resolveAuto } from "./choices";

describe("избор на модел за разпознаване", () => {
  it("разпознава само познатите варианти", () => {
    expect(isSttChoice("auto")).toBe(true);
    expect(isSttChoice("cpu-small")).toBe(true);
    expect(isSttChoice("gpu-turbo-q4f16")).toBe(true);
    expect(isSttChoice("cloud")).toBe(false);
    expect(isSttChoice(undefined)).toBe(false);
    expect(isSttChoice("toString")).toBe(false);
  });

  it("„auto“ избира според видеокартата", () => {
    expect(resolveAuto({ available: true, f16: true })).toBe("gpu-turbo-q4f16");
    expect(resolveAuto({ available: true, f16: false })).toBe("gpu-turbo-q4");
    expect(resolveAuto({ available: false, f16: false })).toBe("cpu-small");
  });

  it("от теста взима варианта с най-малко закъснение", () => {
    expect(
      pickBest([
        { key: "cpu-small", latencySeconds: 3.3 },
        { key: "gpu-turbo-q4f16", latencySeconds: 1.2 },
      ]),
    ).toBe("gpu-turbo-q4f16");
    expect(pickBest([{ key: "gpu-turbo-q4", latencySeconds: Infinity }])).toBeNull();
    expect(pickBest([])).toBeNull();
  });
});
