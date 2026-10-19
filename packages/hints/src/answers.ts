import type { Answer, KnowledgePack } from "@zara-twin/knowledge";
import type { Hint, SegmentInput } from "./engine";
import { triggerPattern } from "./objections";

/**
 * Въпроси на клиента → готово изречение за отговор („Колко е гаранцията?“ →
 * „Гаранцията е до 24 месеца, а сервизът е тук, в България.“). Отговорите са в пакета
 * на бизнеса (answers), затова тук няма нищо специфично за клиент.
 */
export interface AnswerOptions {
  /** Един и същи отговор не се повтаря 3 минути. */
  cooldownMs?: number;
  now?: () => number;
}

/** Най-много толкова отговора от едно изречение: повече не се четат по време на разговор. */
const MAX_PER_SEGMENT = 2;

export class AnswerDetector {
  private readonly matchers: { answer: Answer; patterns: RegExp[] }[];
  private readonly shownAt = new Map<string, number>();
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(pack: KnowledgePack, options: AnswerOptions = {}) {
    this.matchers = (pack.answers ?? []).map((answer) => ({ answer, patterns: answer.triggers.map(triggerPattern) }));
    this.cooldownMs = options.cooldownMs ?? 180_000;
    this.now = options.now ?? Date.now;
  }

  onSegment(segment: SegmentInput): Hint[] {
    // Отговорът е за въпрос на клиента: когато продавачът сам каже „гаранция“, подсказка не трябва.
    if (segment.speaker !== "counterpart") return [];
    const hints: Hint[] = [];
    for (const { answer, patterns } of this.matchers) {
      if (hints.length >= MAX_PER_SEGMENT) break;
      if (!patterns.some((pattern) => pattern.test(segment.text))) continue;
      const key = `answer:${answer.id}`;
      const now = this.now();
      const last = this.shownAt.get(key);
      if (last !== undefined && now - last < this.cooldownMs) continue;
      this.shownAt.set(key, now);
      hints.push({ key, kind: "answer", title: answer.label, say: answer.say, lines: [], sourceUrl: answer.sourceUrl });
    }
    return hints;
  }
}
