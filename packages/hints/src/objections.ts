import type { KnowledgePack, MethodPack, Objection, Tip } from "@zara-twin/knowledge";
import type { Hint, SegmentInput } from "./engine";

/**
 * Подсказки при възражения, без AI модел: метод (как да се отговори) + профил
 * (конкретните условия на бизнеса). Реагира само на думите на събеседника.
 *
 * Ограничение, което е съзнателно: разпознаването е по фрази и ще пропуска
 * перифразирани възражения. Следващото ниво (с AI модел) ще ги разбира по смисъл.
 */
export interface ObjectionOptions {
  /** Едно и също възражение не се повтаря 3 минути. */
  cooldownMs?: number;
  now?: () => number;
}

const B = "(?<![\\p{L}\\p{N}])";

export class ObjectionDetector {
  private readonly matchers: { objection: Objection; patterns: RegExp[] }[];
  private readonly shownAt = new Map<string, number>();
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(
    method: MethodPack,
    private readonly profile: KnowledgePack,
    options: ObjectionOptions = {},
  ) {
    this.matchers = method.objections.map((objection) => ({
      objection,
      patterns: objection.triggers.map(triggerPattern),
    }));
    this.cooldownMs = options.cooldownMs ?? 180_000;
    this.now = options.now ?? Date.now;
  }

  onSegment(segment: SegmentInput): Hint[] {
    // Възраженията идват от клиента. Ако ръководителят каже „не е скъпо“, това не е възражение.
    if (segment.speaker !== "counterpart") return [];
    const hints: Hint[] = [];
    for (const { objection, patterns } of this.matchers) {
      if (!patterns.some((pattern) => matchesWithoutNegation(pattern, segment.text))) continue;
      const key = `objection:${objection.id}`;
      const now = this.now();
      const last = this.shownAt.get(key);
      if (last !== undefined && now - last < this.cooldownMs) continue;
      this.shownAt.set(key, now);
      hints.push({
        key,
        kind: "objection",
        title: objection.label,
        say: objection.say,
        lines: (objection.tips ?? []).map((tip) => this.render(tip)),
      });
    }
    return hints;
  }

  private render(tip: Tip): string {
    if (!tip.policyTopic) return tip.text;
    const policy = this.profile.policies.find((p) => p.topic.startsWith(tip.policyTopic!));
    // Ако профилът няма такава политика, не измисляме: показваме само общия съвет.
    return policy ? `${tip.text} ${policy.text}` : tip.text.replace(/[:：]\s*$/, ".");
  }
}

function triggerPattern(trigger: string): RegExp {
  const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  // До 3 букви окончание: „скъпо“ хваща и „скъпоо“, „съдружник“ и „съдружника“.
  return new RegExp(`${B}${escaped}\\p{L}{0,3}(?![\\p{L}\\p{N}])`, "iu");
}

/** „Не е скъпо“ и „не е рисковано“ не са възражения. Фрази, които сами започват с „не“, се приемат. */
function matchesWithoutNegation(pattern: RegExp, text: string): boolean {
  const match = pattern.exec(text);
  if (!match) return false;
  if (/^не\s/iu.test(match[0])) return true;
  const before = text.slice(0, match.index);
  return !/(?<![\p{L}])не\s+(?:е\s+|са\s+|би\s+)?(?:(?:толкова|чак|много|особено|никак)\s+){0,2}$/iu.test(before);
}
