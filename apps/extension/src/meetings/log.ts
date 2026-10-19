import type { KeyValueStore } from "../transcripts/store";
import { isMeetingReport, type MeetingReport } from "./report";

/**
 * Дневник на срещите: обобщенията (без текста на разговора) на този компютър, 90 дни.
 * Записва се автоматично, освен ако срещата е отбелязана като тестова в панела.
 */
export const REPORTS_KEY = "meetingReports";
/** Ключът „Тестова среща“ в панела остава включен, докато не го изключите. */
export const TEST_MODE_KEY = "meetingTestMode";
export const REPORT_RETENTION_DAYS = 90;
const MAX_REPORTS = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

export class MeetingLog {
  constructor(
    private readonly storage: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {}

  /** Същата среща се презаписва: записът се обновява по време на срещата и в края ѝ. */
  async save(report: MeetingReport): Promise<void> {
    const others = (await this.list()).filter((item) => item.id !== report.id);
    await this.write([report, ...others]);
  }

  /** Най-новите първи; по-старите от 90 дни и повредените записи отпадат. */
  async list(): Promise<MeetingReport[]> {
    const value: unknown = (await this.storage.get(REPORTS_KEY))[REPORTS_KEY];
    if (!Array.isArray(value)) return [];
    const limit = this.now() - REPORT_RETENTION_DAYS * DAY_MS;
    return value.filter(isMeetingReport).filter((r) => r.endedAt >= limit).sort((a, b) => b.startedAt - a.startedAt);
  }

  async remove(id: string): Promise<void> {
    await this.write((await this.list()).filter((item) => item.id !== id));
  }

  async removeAll(): Promise<void> {
    await this.write([]);
  }

  private async write(reports: MeetingReport[]): Promise<void> {
    await this.storage.set({ [REPORTS_KEY]: reports.slice(0, MAX_REPORTS) });
  }
}
