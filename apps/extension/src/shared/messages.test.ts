import { describe, expect, it } from "vitest";
import { isBackgroundMessage, isContentMessage, isOffscreenMessage } from "./messages";

describe("isContentMessage", () => {
  it("приема валидни съобщения", () => {
    expect(isContentMessage({ type: "session-state", active: true })).toBe(true);
    expect(isContentMessage({ type: "audio-level", source: "tab", level: 0.3 })).toBe(true);
    expect(isContentMessage({ type: "capture-notice", tone: "error", text: "…" })).toBe(true);
    expect(isContentMessage({ type: "mic-problem", text: "…" })).toBe(true);
    expect(isContentMessage({ type: "mic-problem" })).toBe(false);
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

  it("проверява запазването на текста", () => {
    const line = { speaker: "owner", text: "Добър ден", at: 1 };
    expect(isBackgroundMessage({ type: "save-transcript", meetingCode: "abc-defg-hij", startedAt: 0, lines: [line] })).toBe(true);
    expect(isBackgroundMessage({ type: "save-transcript", meetingCode: "", startedAt: 0, lines: [] })).toBe(false);
    expect(isBackgroundMessage({ type: "save-transcript", meetingCode: "x", startedAt: 0, lines: [{ ...line, speaker: "boss" }] })).toBe(false);
  });

  it("отказва непознати кодове и типове", () => {
    expect(isBackgroundMessage({ type: "offscreen-error", code: "boom", detail: "" })).toBe(false);
    expect(isBackgroundMessage({ type: "offscreen-start", streamId: "x" })).toBe(false);
  });
});

describe("картите към редовете от разговора", () => {
  const report = (lines: unknown) => ({ type: "save-transcript", meetingCode: "abc-defg-hij", startedAt: 1, lines });
  it("приема заглавие, до 2 реплики и откъде е картата", () => {
    const card = { title: "Отговор", say: ["Минусът е равният под.", "Какъв е подът?"], via: "ai" };
    expect(isBackgroundMessage(report([{ speaker: "counterpart", text: "Минусите?", at: 1, cards: [card] }]))).toBe(true);
    expect(isBackgroundMessage(report([{ speaker: "counterpart", text: "Минусите?", at: 1 }]))).toBe(true);
  });
  it("отказва странни карти", () => {
    const line = (cards: unknown) => report([{ speaker: "counterpart", text: "x", at: 1, cards }]);
    expect(isBackgroundMessage(line([{ title: "x", via: "magic" }]))).toBe(false);
    expect(isBackgroundMessage(line([{ title: "x", via: "ai", say: ["a", "b", "c"] }]))).toBe(false);
    expect(isBackgroundMessage(line(Array(5).fill({ title: "x", via: "phrase" })))).toBe(false);
    expect(isBackgroundMessage(line("не е списък"))).toBe(false);
  });
});

describe("AI отговор (ai-suggest)", () => {
  it("кратък въпрос и до 6 реплики контекст", () => {
    const turns = [{ speaker: "client", text: "Здравейте" }];
    expect(isBackgroundMessage({ type: "ai-suggest", question: "Какви са минусите?", turns })).toBe(true);
    expect(isBackgroundMessage({ type: "ai-suggest", question: "а", turns })).toBe(false);
    expect(isBackgroundMessage({ type: "ai-suggest", question: "Какви са минусите?", turns: Array(7).fill(turns[0]) })).toBe(false);
    expect(isBackgroundMessage({ type: "ai-suggest", question: "Какви са минусите?", turns: [{ speaker: "owner", text: "x" }] })).toBe(false);
    expect(isBackgroundMessage({ type: "ai-suggest", question: "в".repeat(400), turns })).toBe(false);
  });
});

describe("isOffscreenMessage", () => {
  it("изисква непразен streamId", () => {
    expect(isOffscreenMessage({ type: "offscreen-start", streamId: "abc", stt: "auto" })).toBe(true);
    expect(isOffscreenMessage({ type: "offscreen-start", streamId: "", stt: "auto" })).toBe(false);
    expect(isOffscreenMessage({ type: "offscreen-start", streamId: "abc", stt: "cloud" })).toBe(false);
    expect(isOffscreenMessage({ type: "offscreen-start", streamId: "abc", stt: "auto", withVideo: true })).toBe(true);
    expect(isOffscreenMessage({ type: "offscreen-start", streamId: "abc", stt: "auto", withVideo: "yes" })).toBe(false);
    const cloud = { provider: "speechmatics", apiKey: "x".repeat(32) };
    expect(isOffscreenMessage({ type: "offscreen-start", streamId: "abc", stt: "auto", cloud })).toBe(true);
    expect(isOffscreenMessage({ type: "offscreen-start", streamId: "abc", stt: "auto", cloud: { provider: "azure", apiKey: "x".repeat(32) } })).toBe(false);
    expect(isOffscreenMessage({ type: "offscreen-stop" })).toBe(true);
  });

  it("разбиране по смисъл: само известен модел и непразно изречение", () => {
    expect(isOffscreenMessage({ type: "offscreen-start", streamId: "abc", stt: "auto", meaning: "large" })).toBe(true);
    expect(isOffscreenMessage({ type: "offscreen-start", streamId: "abc", stt: "auto", meaning: "huge" })).toBe(false);
    expect(isOffscreenMessage({ type: "meaning-match", text: "Колко ще ми излезе?" })).toBe(true);
    expect(isOffscreenMessage({ type: "meaning-match", text: "" })).toBe(false);
    expect(isOffscreenMessage({ type: "meaning-match", text: "а".repeat(3000) })).toBe(false);
  });

  it("отказва всичко останало", () => {
    expect(isOffscreenMessage(null)).toBe(false);
    expect(isOffscreenMessage("offscreen-stop")).toBe(false);
    expect(isOffscreenMessage({ type: "panel-closed" })).toBe(false);
  });
});
