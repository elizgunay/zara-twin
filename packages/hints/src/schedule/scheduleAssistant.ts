import { overlaps, type CalendarProvider, type TimeRange } from "@zara-twin/core";
import type { Hint, SegmentInput } from "../engine";
import { firstFreeSlot, freeWindows, mergeBusy } from "./freeSlots";
import { formatTime, parseSchedule, type ScheduleMention } from "./parseSchedule";

/**
 * Проверка на календара при уговаряне на среща: „следващата сряда в 10“ →
 * „Зает: сряда, 21 окт., 10:00. Друг ангажимент 10:30–11:30. Свободно: 11:30–12:30“.
 *
 * Без свързан календар пак помага: показва конкретната дата, за да няма
 * недоразумение какво значи „следващата сряда“.
 */
export interface ScheduleAssistantOptions {
  now?: () => Date;
  cooldownMs?: number;
  workday?: { fromHour: number; toHour: number };
}

export class ScheduleAssistant {
  private readonly shownAt = new Map<string, number>();
  private readonly now: () => Date;
  private readonly cooldownMs: number;
  private readonly workday: { fromHour: number; toHour: number };

  constructor(
    private readonly calendar: CalendarProvider | null,
    options: ScheduleAssistantOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.cooldownMs = options.cooldownMs ?? 120_000;
    this.workday = options.workday ?? { fromHour: 9, toHour: 18 };
  }

  async onSegment(segment: SegmentInput): Promise<Hint[]> {
    const now = this.now();
    const mention = parseSchedule(segment.text, now);
    if (mention === null) return [];

    const key = `calendar:${mention.start.getTime()}:${mention.end.getTime()}`;
    const last = this.shownAt.get(key);
    if (last !== undefined && now.getTime() - last < this.cooldownMs) return [];
    this.shownAt.set(key, now.getTime());

    if (this.calendar === null) {
      return [{ key, kind: "calendar", title: `Час: ${mention.label}`, lines: ["Календарът не е свързан. Проверете ръчно."] }];
    }

    const day = this.workdayOf(mention.start);
    let busy: TimeRange[];
    try {
      busy = mergeBusy(await this.calendar.busy(day));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      const line =
        reason === "not-connected" || reason === "not-configured"
          ? "Календарът не е свързан (настройки на разширението). Проверете ръчно."
          : "Календарът не отговаря. Проверете ръчно.";
      // Нов опит при следващото споменаване, вместо да мълчим 2 минути.
      this.shownAt.delete(key);
      return [{ key, kind: "calendar", title: `Час: ${mention.label}`, lines: [line] }];
    }

    return [mention.exactTime ? this.exactHint(key, mention, busy, day) : this.rangeHint(key, mention, busy)];
  }

  private exactHint(key: string, mention: ScheduleMention, busy: TimeRange[], day: TimeRange): Hint {
    const conflicts = busy.filter((range) => overlaps(range, mention));
    if (conflicts.length === 0) {
      return { key, kind: "calendar-free", title: `Свободен: ${mention.label}`, lines: ["Няма друг ангажимент в календара."] };
    }
    const lines = conflicts.map((c) => `Друг ангажимент ${span(c)}`);
    const minutes = (mention.end.getTime() - mention.start.getTime()) / 60_000;
    const alternative =
      firstFreeSlot(busy, mention.start, day.end, minutes) ?? firstFreeSlot(busy, day.start, mention.start, minutes);
    lines.push(alternative ? `Свободно: ${span(alternative)}` : "Няма свободен час този ден.");
    return { key, kind: "calendar-busy", title: `Зает: ${mention.label}`, lines };
  }

  private rangeHint(key: string, mention: ScheduleMention, busy: TimeRange[]): Hint {
    const windows = freeWindows(busy, mention, 30);
    if (windows.length === 0) {
      return { key, kind: "calendar-busy", title: `Зает: ${mention.label}`, lines: ["Няма свободен прозорец."] };
    }
    const lines = windows.slice(0, 3).map((w) => `Свободно: ${span(w)}`);
    return { key, kind: "calendar-free", title: mention.label, lines };
  }

  private workdayOf(date: Date): TimeRange {
    const at = (hour: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour);
    return { start: at(this.workday.fromHour), end: at(this.workday.toHour) };
  }
}

function span(range: TimeRange): string {
  return `${formatTime(range.start)}–${formatTime(range.end)}`;
}
