import { describe, expect, it } from "vitest";
import { buildAuthUrl, FREEBUSY_SCOPE, freeBusyRequestBody, parseAuthRedirect, parseFreeBusyResponse } from "./google";

const REDIRECT = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/";

describe("вход в Google", () => {
  it("иска само достъп до свободните часове", () => {
    const url = new URL(buildAuthUrl("client-123", REDIRECT, true));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe(FREEBUSY_SCOPE);
    expect(url.searchParams.get("response_type")).toBe("token");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(new URL(buildAuthUrl("c", REDIRECT, false)).searchParams.get("prompt")).toBe("none");
  });

  it("чете токена и изтичането му с резерв от 60 s", () => {
    const token = parseAuthRedirect(`${REDIRECT}#access_token=abc&expires_in=3599&scope=${encodeURIComponent(FREEBUSY_SCOPE)}`, 1_000);
    expect(token).toEqual({ accessToken: "abc", expiresAt: 1_000 + 3539 * 1000 });
  });

  it("отказва при грешка, липсващ токен или друг обхват", () => {
    expect(() => parseAuthRedirect(`${REDIRECT}#error=access_denied`, 0)).toThrow(/access_denied/);
    expect(() => parseAuthRedirect(`${REDIRECT}#expires_in=3600`, 0)).toThrow();
    expect(() => parseAuthRedirect(`${REDIRECT}#access_token=a&expires_in=3600&scope=email`, 0)).toThrow(/свободните часове/);
  });
});

describe("freeBusy", () => {
  const range = { start: new Date("2026-10-21T06:00:00Z"), end: new Date("2026-10-21T15:00:00Z") };

  it("пита само за основния календар", () => {
    expect(JSON.parse(freeBusyRequestBody(range))).toEqual({
      timeMin: "2026-10-21T06:00:00.000Z",
      timeMax: "2026-10-21T15:00:00.000Z",
      items: [{ id: "primary" }],
    });
  });

  it("превръща отговора в заети интервали", () => {
    const busy = parseFreeBusyResponse({
      calendars: { primary: { busy: [{ start: "2026-10-21T07:30:00Z", end: "2026-10-21T08:30:00Z" }] } },
    });
    expect(busy).toEqual([{ start: new Date("2026-10-21T07:30:00Z"), end: new Date("2026-10-21T08:30:00Z") }]);
  });

  it("грешка в календара не се представя като „свободен“", () => {
    expect(() => parseFreeBusyResponse({ calendars: { primary: { errors: [{ reason: "notFound" }] } } })).toThrow();
    expect(() => parseFreeBusyResponse({})).toThrow();
  });
});
