import { describe, expect, it } from "vitest";
import { parseMeetCode } from "./meetUrl";

describe("parseMeetCode", () => {
  it("извлича кода на срещата", () => {
    expect(parseMeetCode("https://meet.google.com/abc-defg-hij")).toBe("abc-defg-hij");
    expect(parseMeetCode("https://meet.google.com/abc-defg-hij?authuser=0")).toBe("abc-defg-hij");
    expect(parseMeetCode("https://meet.google.com/abc-defg-hij/")).toBe("abc-defg-hij");
  });

  it("връща null, когато не е среща", () => {
    expect(parseMeetCode("https://meet.google.com/")).toBeNull();
    expect(parseMeetCode("https://meet.google.com/landing")).toBeNull();
    expect(parseMeetCode("https://meet.google.com/new")).toBeNull();
  });

  it("отказва чужди домейни и невалидни адреси", () => {
    expect(parseMeetCode("https://evil.example/abc-defg-hij")).toBeNull();
    expect(parseMeetCode("http://meet.google.com/abc-defg-hij")).toBeNull();
    expect(parseMeetCode("не е адрес")).toBeNull();
  });
});
