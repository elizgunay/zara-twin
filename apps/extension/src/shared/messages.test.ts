import { describe, expect, it } from "vitest";
import { isBackgroundMessage, isContentMessage, isOffscreenMessage } from "./messages";

describe("isContentMessage", () => {
  it("приема валидни съобщения", () => {
    expect(isContentMessage({ type: "session-state", active: true })).toBe(true);
    expect(isContentMessage({ type: "audio-level", source: "tab", level: 0.3 })).toBe(true);
    expect(isContentMessage({ type: "capture-notice", tone: "error", text: "…" })).toBe(true);
  });

  it("отказва грешни полета", () => {
    expect(isContentMessage({ type: "session-state", active: "yes" })).toBe(false);
    expect(isContentMessage({ type: "audio-level", source: "speaker", level: 0.3 })).toBe(false);
    expect(isContentMessage({ type: "audio-level", source: "tab", level: 7 })).toBe(false);
    expect(isContentMessage({ type: "capture-notice", tone: "html", text: "<b>" })).toBe(false);
  });

  it("проверява изреченията от разговора", () => {
    expect(isContentMessage({ type: "transcript-segment", speaker: "counterpart", text: "Колко струва?" })).toBe(true);
    expect(isContentMessage({ type: "transcript-segment", speaker: "boss", text: "…" })).toBe(false);
    expect(isContentMessage({ type: "transcript-segment", speaker: "owner", text: "х".repeat(2001) })).toBe(false);
  });
});

describe("isBackgroundMessage", () => {
  it("приема валидни съобщения", () => {
    expect(isBackgroundMessage({ type: "panel-closed" })).toBe(true);
    expect(isBackgroundMessage({ type: "offscreen-level", source: "microphone", level: 0 })).toBe(true);
    expect(isBackgroundMessage({ type: "offscreen-error", code: "mic-unavailable", detail: "" })).toBe(true);
  });

  it("проверява заявката към календара", () => {
    const day = 9 * 60 * 60 * 1000;
    expect(isBackgroundMessage({ type: "calendar-busy", start: 0, end: day })).toBe(true);
    expect(isBackgroundMessage({ type: "calendar-busy", start: day, end: 0 })).toBe(false);
    expect(isBackgroundMessage({ type: "calendar-busy", start: 0, end: 30 * 24 * day })).toBe(false);
    expect(isBackgroundMessage({ type: "calendar-busy", start: "0", end: day })).toBe(false);
  });

  it("проверява текста и състоянието от разпознаването", () => {
    expect(isBackgroundMessage({ type: "offscreen-transcript", speaker: "owner", text: "Добър ден", latencyMs: 1200 })).toBe(true);
    expect(isBackgroundMessage({ type: "offscreen-transcript", speaker: "owner", text: "Добър ден", latencyMs: null })).toBe(true);
    expect(isBackgroundMessage({ type: "offscreen-transcript", speaker: "owner", text: "х", latencyMs: -5 })).toBe(false);
    expect(isBackgroundMessage({ type: "offscreen-status", tone: "info", text: "Зареждане…" })).toBe(true);
    expect(isContentMessage({ type: "transcript-segment", speaker: "owner", text: "х", latencyMs: Number.NaN })).toBe(false);
  });

  it("отказва непознати кодове и типове", () => {
    expect(isBackgroundMessage({ type: "offscreen-error", code: "boom", detail: "" })).toBe(false);
    expect(isBackgroundMessage({ type: "offscreen-start", streamId: "x" })).toBe(false);
  });
});

describe("isOffscreenMessage", () => {
  it("изисква непразен streamId", () => {
    expect(isOffscreenMessage({ type: "offscreen-start", streamId: "abc", stt: "auto" })).toBe(true);
    expect(isOffscreenMessage({ type: "offscreen-start", streamId: "", stt: "auto" })).toBe(false);
    expect(isOffscreenMessage({ type: "offscreen-start", streamId: "abc", stt: "cloud" })).toBe(false);
    expect(isOffscreenMessage({ type: "offscreen-stop" })).toBe(true);
  });

  it("отказва всичко останало", () => {
    expect(isOffscreenMessage(null)).toBe(false);
    expect(isOffscreenMessage("offscreen-stop")).toBe(false);
    expect(isOffscreenMessage({ type: "panel-closed" })).toBe(false);
  });
});
