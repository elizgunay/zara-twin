import type { MethodPack, Nudge } from "@zara-twin/knowledge";
import type { Hint, SegmentInput } from "./engine";
import { triggerPattern } from "./objections";
import { parseSchedule } from "./schedule/parseSchedule";

/**
 * Подсказки за думите на самия продавач: „ще се опитам“, „ще ви пратя“, „ще се чуем“ без
 * ден и час → готово изречение с конкретна стъпка. Ако изречението вече съдържа ден/час
 * („ще ви пратя офертата утре до 17“), мълчи: стъпката е конкретна.
 */
export interface NudgeOptions {
  cooldownMs?: number;
  now?: () => number;
}

export class NudgeDetector {
  private readonly matchers: { nudge: Nudge; patterns: RegExp[] }[];
  private readonly shownAt = new Map<string, number>();
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(method: MethodPack, options: NudgeOptions = {}) {
    this.matchers = (method.nudges ?? []).map((nudge) => ({ nudge, patterns: nudge.triggers.map(triggerPattern) }));
    this.cooldownMs = options.cooldownMs ?? 180_000;
    this.now = options.now ?? Date.now;
  }

  onSegment(segment: SegmentInput): Hint[] {
    if (segment.speaker !== "owner") return [];
    const now = this.now();
    if (parseSchedule(segment.text, new Date(now)) !== null) return [];
    const hints: Hint[] = [];
    for (const { nudge, patterns } of this.matchers) {
      if (!patterns.some((p) => p.test(segment.text))) continue;
      const key = `nudge:${nudge.id}`;
      const last = this.shownAt.get(key);
      if (last !== undefined && now - last < this.cooldownMs) continue;
      this.shownAt.set(key, now);
      hints.push({ key, kind: "talk", title: nudge.label, say: nudge.say, lines: [] });
    }
    return hints;
  }
}
