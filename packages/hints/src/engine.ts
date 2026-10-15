import type { SpeakerRole } from "@zara-twin/core";
import { MentionFinder, productCard, type KnowledgePack } from "@zara-twin/knowledge";

/**
 * Първото ниво подсказки: детерминистични, от пакета със знания, без AI модел.
 * Бързи (милисекунди), безплатни и не могат да измислят факти.
 * Подсказките за преговори (възражения) ще дойдат по-късно, с AI модел.
 */
export interface Hint {
  /** Ключ за повторения: една и съща подсказка не се показва отново в рамките на cooldown. */
  key: string;
  kind: "product" | "family" | "no-data";
  title: string;
  lines: string[];
  sourceUrl?: string;
}

export interface HintEngineOptions {
  /** Колко време една подсказка не се повтаря. По подразбиране 2 минути. */
  cooldownMs?: number;
  /** Най-много продукти от едно изречение. */
  maxProducts?: number;
  now?: () => number;
}

export interface SegmentInput {
  speaker: SpeakerRole;
  text: string;
}

/** Въпроси за пари. Пакетът няма цени, затова Copilot казва „няма данни“, вместо да гадае. */
const PRICE_QUESTION = /(цен[аиа]|ценоразпис|колко\s+(?:ще\s+)?(?:струва|излиза|ни\s+излиза)|стойност)/iu;
const DISCOUNT_QUESTION = /(отстъпк|намален|по-добра\s+цена|по-евтин)/iu;
const LEASING_QUESTION = /(лизинг|на\s+вноски|разсрочен|наем)/iu;

export class HintEngine {
  private readonly finder: MentionFinder;
  private readonly shownAt = new Map<string, number>();
  private readonly cooldownMs: number;
  private readonly maxProducts: number;
  private readonly now: () => number;

  constructor(
    private readonly pack: KnowledgePack,
    options: HintEngineOptions = {},
  ) {
    this.finder = new MentionFinder(pack);
    this.cooldownMs = options.cooldownMs ?? 120_000;
    this.maxProducts = options.maxProducts ?? 2;
    this.now = options.now ?? Date.now;
  }

  onSegment(segment: SegmentInput): Hint[] {
    const candidates: Hint[] = [];
    const mentions = this.finder.find(segment.text);

    for (const product of mentions.products.slice(0, this.maxProducts)) {
      const card = productCard(product);
      candidates.push({ key: `product:${product.id}`, kind: "product", ...card });
    }

    for (const family of mentions.families) {
      const products = this.finder.productsOf(family);
      candidates.push({
        key: `family:${family.id}`,
        kind: "family",
        title: `Серия ${family.name}: ${products.length} модела`,
        lines: products.map((p) => `${p.code}: ${firstClause(p.summary)}`),
      });
    }

    candidates.push(...this.noDataHints(segment.text));
    return candidates.filter((hint) => this.allow(hint.key));
  }

  private noDataHints(text: string): Hint[] {
    const hints: Hint[] = [];
    const missing = (prefix: string) => this.pack.missing.some((item) => item.startsWith(prefix));

    if (PRICE_QUESTION.test(text) && missing("Цени")) {
      hints.push({
        key: "no-data:price",
        kind: "no-data",
        title: "Няма данни за цени",
        lines: ["Не давайте цифра на момента.", "Предложете писмена оферта след срещата."],
      });
    }
    if (DISCOUNT_QUESTION.test(text) && missing("Граници на отстъпките")) {
      hints.push({
        key: "no-data:discount",
        kind: "no-data",
        title: "Няма данни за отстъпки",
        lines: ["Не обещавайте отстъпка на момента.", "Отговорете, че ще я включите в офертата."],
      });
    }
    if (LEASING_QUESTION.test(text)) {
      const policy = this.pack.policies.find((p) => p.topic.startsWith("Покупка или наем"));
      if (policy) {
        hints.push({
          key: "policy:purchase",
          kind: "no-data",
          title: "Покупка или наем",
          lines: [policy.text, ...(missing("Условия за плащане") ? ["Няма данни за лизинг и вноски."] : [])],
          sourceUrl: policy.sourceUrl,
        });
      }
    }
    return hints;
  }

  private allow(key: string): boolean {
    const now = this.now();
    const last = this.shownAt.get(key);
    if (last !== undefined && now - last < this.cooldownMs) return false;
    this.shownAt.set(key, now);
    return true;
  }
}

function firstClause(text: string): string {
  const clause = text.split(/[,.;:]/)[0]!.trim();
  return clause.length > 70 ? `${clause.slice(0, 67)}...` : clause;
}
