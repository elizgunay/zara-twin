import type { AudioChunk, MeetingAdapter, MeetingInfo, Unsubscribe } from "@zara-twin/core";
import { parseMeetCode } from "./meetUrl";

/**
 * Адаптерът за Google Meet (Р4). Ядрото и панелът работят само с MeetingAdapter,
 * така че Zoom и Teams по-късно добавят свой адаптер, без промени другаде.
 */
export class GoogleMeetAdapter implements MeetingAdapter {
  readonly platform = "google-meet" as const;
  private startedAt: number | null = null;

  constructor(private readonly getUrl: () => string = () => location.href) {}

  currentMeeting(): MeetingInfo | null {
    const code = parseMeetCode(this.getUrl());
    if (code === null) {
      this.startedAt = null;
      return null;
    }
    // Meet не дава точния час на началото, затова броим от първото засичане.
    this.startedAt ??= Date.now();
    return { id: code, platform: this.platform, startedAt: this.startedAt };
  }

  startCapture(_onAudio: (chunk: AudioChunk) => void): Promise<Unsubscribe> {
    // Следваща стъпка от Фаза 1.0: tabCapture + offscreen документ.
    return Promise.reject(new Error("Прихващането на звук още не е реализирано."));
  }
}
