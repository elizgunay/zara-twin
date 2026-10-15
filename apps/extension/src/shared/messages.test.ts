import { describe, expect, it } from "vitest";
import { isCopilotMessage } from "./messages";

describe("isCopilotMessage", () => {
  it("приема познатите съобщения", () => {
    expect(isCopilotMessage({ type: "toggle-panel" })).toBe(true);
  });

  it("отказва всичко останало", () => {
    expect(isCopilotMessage({ type: "delete-everything" })).toBe(false);
    expect(isCopilotMessage({ type: 42 })).toBe(false);
    expect(isCopilotMessage("toggle-panel")).toBe(false);
    expect(isCopilotMessage(null)).toBe(false);
    expect(isCopilotMessage(undefined)).toBe(false);
  });
});
