import type { CalendarProvider, TimeRange } from "@zara-twin/core";
import type { BackgroundMessage, CalendarBusyResponse } from "../shared/messages";

/**
 * Календарът, както го вижда content script-ът: заявка към service worker-а,
 * който единствен държи токена. Страницата на Meet никога не вижда токена.
 */
export class ExtensionCalendarProvider implements CalendarProvider {
  readonly id = "google-calendar";

  async busy(range: TimeRange): Promise<TimeRange[]> {
    const request: BackgroundMessage = { type: "calendar-busy", start: range.start.getTime(), end: range.end.getTime() };
    const response = (await chrome.runtime.sendMessage(request)) as CalendarBusyResponse | undefined;
    if (!response?.ok) throw new Error(response?.error ?? "failed");
    return response.busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  }
}
