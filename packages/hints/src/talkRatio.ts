import type { AudioSourceKind } from "@zara-twin/core";
import type { TalkRatioRules } from "@zara-twin/knowledge";
import type { Hint } from "./engine";

/**
 * Кой колко говори, само от силата на звука, без разпознаване на говор.
 * Микрофонът = ръководителят, звукът на таба = клиентът (виж AudioSourceKind).
 *
 * Ехо: без слушалки микрофонът хваща и гласа на клиента от високоговорителите.
 * Ако клиентът говори и микрофонът е значително по-тих, приемаме, че е ехо.
 */
export interface TalkRatioOptions {
  rules?: Partial<TalkRatioRules>;
  /** RMS, над който звукът се смята за говор (като в разделянето на изказвания). */
  speechThreshold?: number;
  /** Продължителност на едно парче звук. Разширението праща по 100 ms. */
  frameMs?: number;
  /** Под толкова общо говорене в периода делът не е показателен. */
  minTalkMs?: number;
  /** Пауза, след която монологът се смята за прекъснат. */
  pauseMs?: number;
  cooldownMs?: number;
}

export interface TalkStats {
  ownerMs: number;
  counterpartMs: number;
  /** Дял на ръководителя (0–1), или null, ако още никой не е говорил. */
  ownerShare: number | null;
}

const DEFAULT_RULES: TalkRatioRules = { maxOwnerShare: 0.65, windowMinutes: 3, monologueSeconds: 60 };
const ECHO_RATIO = 0.5;
const PAIR_MS = 150;

export class TalkRatioTracker {
  private readonly rules: TalkRatioRules;
  private readonly threshold: number;
  private readonly frameMs: number;
  private readonly minTalkMs: number;
  private readonly pauseMs: number;
  private readonly cooldownMs: number;

  private readonly frames: { at: number; owner: boolean }[] = [];
  private sessionOwner = 0;
  private sessionCounterpart = 0;
  private lastTab = { level: 0, at: -Infinity };
  private runStart: number | null = null;
  private lastOwnerAt = -Infinity;
  private readonly shownAt = new Map<string, number>();

  constructor(options: TalkRatioOptions = {}) {
    this.rules = { ...DEFAULT_RULES, ...options.rules };
    this.threshold = options.speechThreshold ?? 0.012;
    this.frameMs = options.frameMs ?? 100;
    this.minTalkMs = options.minTalkMs ?? 60_000;
    this.pauseMs = options.pauseMs ?? 1_500;
    this.cooldownMs = options.cooldownMs ?? 180_000;
  }

  onLevel(source: AudioSourceKind, level: number, at: number): Hint[] {
    if (level < this.threshold) return this.check(at);

    if (source === "tab") {
      this.lastTab = { level, at };
      this.record(at, false);
      this.runStart = null; // клиентът се включи: монологът приключва
    } else {
      const tabActive = at - this.lastTab.at <= PAIR_MS && this.lastTab.level >= this.threshold;
      if (tabActive && level < this.lastTab.level * ECHO_RATIO) return this.check(at); // ехо от високоговорителите
      this.record(at, true);
      if (this.runStart === null || at - this.lastOwnerAt > this.pauseMs) this.runStart = at;
      this.lastOwnerAt = at;
    }
    return this.check(at);
  }

  session(): TalkStats {
    return stats(this.sessionOwner, this.sessionCounterpart);
  }

  window(at: number): TalkStats {
    this.prune(at);
    let owner = 0;
    let counterpart = 0;
    for (const frame of this.frames) {
      if (frame.owner) owner += this.frameMs;
      else counterpart += this.frameMs;
    }
    return stats(owner, counterpart);
  }

  private record(at: number, owner: boolean): void {
    this.frames.push({ at, owner });
    if (owner) this.sessionOwner += this.frameMs;
    else this.sessionCounterpart += this.frameMs;
  }

  private prune(at: number): void {
    const since = at - this.rules.windowMinutes * 60_000;
    while (this.frames.length > 0 && this.frames[0]!.at < since) this.frames.shift();
  }

  private check(at: number): Hint[] {
    const hints: Hint[] = [];

    if (this.runStart !== null && at - this.lastOwnerAt <= this.pauseMs) {
      const seconds = Math.round((at - this.runStart) / 1000);
      if (seconds >= this.rules.monologueSeconds && this.allow("talk:monologue", at)) {
        hints.push({
          key: "talk:monologue",
          kind: "talk",
          title: `Говорите ${seconds} s без пауза`,
          // Готов въпрос за казване, не съвет: няма време за четене по време на разговор.
          say: ["А как е при вас в момента?"],
          lines: [],
        });
      }
    }

    const window = this.window(at);
    if (
      window.ownerShare !== null &&
      window.ownerMs + window.counterpartMs >= this.minTalkMs &&
      window.ownerShare > this.rules.maxOwnerShare &&
      this.allow("talk:ratio", at)
    ) {
      hints.push({
        key: "talk:ratio",
        kind: "talk",
        // Закръгляне нагоре: 65,3% над прага от 65% не бива да изглежда като „65%“.
        title: `Говорите ${Math.ceil(window.ownerShare * 100)}% от времето`,
        say: ["Какво е най-важно за вас в това решение?"],
        lines: [],
      });
    }
    return hints;
  }

  private allow(key: string, at: number): boolean {
    const last = this.shownAt.get(key);
    if (last !== undefined && at - last < this.cooldownMs) return false;
    this.shownAt.set(key, at);
    return true;
  }
}

function stats(ownerMs: number, counterpartMs: number): TalkStats {
  const total = ownerMs + counterpartMs;
  return { ownerMs, counterpartMs, ownerShare: total === 0 ? null : ownerMs / total };
}
