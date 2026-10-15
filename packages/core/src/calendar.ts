/**
 * Календарът е скрит зад интерфейс, както платформата за срещи и разпознаването на говор.
 * Google Calendar е първият доставчик, а Outlook може да се добави по-късно.
 *
 * Поверителност: доставчикът връща само заетите интервали (free/busy), без заглавия,
 * участници или описания на събитията. Copilot-ът казва „зает 10:30–11:30“, не „среща с Х“.
 */
export interface TimeRange {
  start: Date;
  end: Date;
}

export interface CalendarProvider {
  readonly id: string;
  /** Заетите интервали в дадения период, сортирани или не. */
  busy(range: TimeRange): Promise<TimeRange[]>;
}

export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}
