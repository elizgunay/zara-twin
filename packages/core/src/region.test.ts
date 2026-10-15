import { describe, expect, it } from "vitest";
import { assertEuRegion, isEuRegion } from "./region";

describe("EU регион (Р22)", () => {
  it("приема региони в ЕС и локална обработка", () => {
    expect(isEuRegion("europe-west4")).toBe(true);
    expect(isEuRegion("WestEurope")).toBe(true);
    expect(isEuRegion("local")).toBe(true);
  });

  it("отказва региони извън ЕС", () => {
    expect(isEuRegion("us-central1")).toBe(false);
    expect(isEuRegion("eastus")).toBe(false);
    // Лондон и Цюрих са в Европа, но не в ЕС.
    expect(isEuRegion("europe-west2")).toBe(false);
    expect(isEuRegion("switzerlandnorth")).toBe(false);
  });

  it("assertEuRegion спира доставчик извън ЕС", () => {
    expect(() => assertEuRegion("google-stt", "us-central1")).toThrow(/не е в ЕС/);
    expect(() => assertEuRegion("azure-speech", "westeurope")).not.toThrow();
  });
});
