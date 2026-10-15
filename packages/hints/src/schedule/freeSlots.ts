import type { TimeRange } from "@zara-twin/core";

/** Сортира и слива застъпващите се заети интервали. */
export function mergeBusy(busy: readonly TimeRange[]): TimeRange[] {
  const sorted = [...busy].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      if (range.end > last.end) last.end = range.end;
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }
  return merged;
}

/** Свободните прозорци в даден период, не по-кратки от minMinutes. */
export function freeWindows(busy: readonly TimeRange[], within: TimeRange, minMinutes = 30): TimeRange[] {
  const windows: TimeRange[] = [];
  let cursor = within.start;
  for (const range of mergeBusy(busy)) {
    if (range.end <= within.start || range.start >= within.end) continue;
    if (range.start > cursor) windows.push({ start: cursor, end: range.start });
    if (range.end > cursor) cursor = range.end;
  }
  if (cursor < within.end) windows.push({ start: cursor, end: within.end });
  return windows.filter((w) => w.end.getTime() - w.start.getTime() >= minMinutes * 60_000);
}

/** Първият свободен интервал с дадената продължителност, започващ не по-рано от `from`. */
export function firstFreeSlot(
  busy: readonly TimeRange[],
  from: Date,
  until: Date,
  durationMinutes: number,
): TimeRange | null {
  const duration = durationMinutes * 60_000;
  for (const window of freeWindows(busy, { start: from, end: until }, durationMinutes)) {
    return { start: window.start, end: new Date(window.start.getTime() + duration) };
  }
  return null;
}
