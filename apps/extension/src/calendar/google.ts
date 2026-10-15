import type { TimeRange } from "@zara-twin/core";

/**
 * Google Calendar чрез най-тесния възможен достъп: `calendar.freebusy`.
 * Разширението вижда САМО кога е зает ръководителят, не заглавията, участниците
 * или описанията на събитията. Това е умишлено (поверителност, по-лесна проверка от Google).
 */
export const FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
const FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";

export interface StoredToken {
  accessToken: string;
  /** Date.now() + expires_in, с 60 s резерв. */
  expiresAt: number;
}

/** Адресът за вход в Google (implicit flow: токенът идва в адреса, без тайна в разширението). */
export function buildAuthUrl(clientId: string, redirectUri: string, interactive: boolean): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "token",
    redirect_uri: redirectUri,
    scope: FREEBUSY_SCOPE,
    include_granted_scopes: "true",
    // Без прозорец, ако вече има разрешение. Иначе Google пита ръководителя.
    prompt: interactive ? "consent" : "none",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Чете токена от адреса, към който Google пренасочва след входа. */
export function parseAuthRedirect(redirectUrl: string, now: number): StoredToken {
  const fragment = new URL(redirectUrl).hash.replace(/^#/, "");
  const params = new URLSearchParams(fragment);
  const error = params.get("error");
  if (error) throw new Error(`Google отказа достъп: ${error}`);
  const accessToken = params.get("access_token");
  const expiresIn = Number(params.get("expires_in"));
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("Google не върна токен за достъп.");
  }
  if (!(params.get("scope") ?? FREEBUSY_SCOPE).split(" ").includes(FREEBUSY_SCOPE)) {
    throw new Error("Не е дадено разрешение за свободните часове в календара.");
  }
  return { accessToken, expiresAt: now + (expiresIn - 60) * 1000 };
}

export function freeBusyRequestBody(range: TimeRange): string {
  return JSON.stringify({
    timeMin: range.start.toISOString(),
    timeMax: range.end.toISOString(),
    items: [{ id: "primary" }],
  });
}

/** Отговорът на freeBusy → заети интервали. Грешка за календара не се крие като „свободен“. */
export function parseFreeBusyResponse(json: unknown): TimeRange[] {
  const primary = (json as { calendars?: { primary?: { busy?: unknown; errors?: unknown[] } } })?.calendars?.primary;
  if (!primary) throw new Error("Календарът не върна данни.");
  if (Array.isArray(primary.errors) && primary.errors.length > 0) {
    throw new Error("Календарът върна грешка.");
  }
  if (!Array.isArray(primary.busy)) return [];
  return primary.busy.map((item: { start?: string; end?: string }) => {
    const start = new Date(item.start ?? "");
    const end = new Date(item.end ?? "");
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error("Календарът върна невалиден интервал.");
    }
    return { start, end };
  });
}

export async function fetchBusy(token: string, range: TimeRange): Promise<TimeRange[]> {
  const response = await fetch(FREEBUSY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: freeBusyRequestBody(range),
  });
  if (response.status === 401) throw new Error("unauthorized");
  if (!response.ok) throw new Error(`Календарът отговори с ${response.status}.`);
  return parseFreeBusyResponse(await response.json());
}
