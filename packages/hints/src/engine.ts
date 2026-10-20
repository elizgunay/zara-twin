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
  kind: "product" | "family" | "no-data" | "objection" | "answer" | "talk" | "calendar" | "calendar-free" | "calendar-busy";
  title: string;
  lines: string[];
  /** Готови изречения за казване дословно (при възражения). Показват се с едър шрифт над lines. */
  say?: string[];
  sourceUrl?: string;
  /** Разпознато по смисъл (локален модел), а не по фраза от пакета. Панелът го отбелязва. */
  byMeaning?: boolean;
  /** Съставено от AI модел от фактите на фирмата (няма готова карта). Панелът го отбелязва. */
  byAi?: boolean;
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
      // Серия с един модел: директно картата му, вместо списък от един ред.
      if (products.length === 1) {
        const [only] = products;
        if (!mentions.products.includes(only!)) {
          candidates.push({ key: `product:${only!.id}`, kind: "product", ...productCard(only!) });
        }
        continue;
      }
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
    // Цените и отстъпките ги казва собственикът: не му казваме да мълчи.
    const ownerPrices = this.pack.pricing === "owner";

    if (!ownerPrices && PRICE_QUESTION.test(text) && missing("Цени")) {
      hints.push({
        key: "no-data:price",
        kind: "no-data",
        title: "Няма данни за цени",
        say: ["Ще ви изпратя точна оферта днес, след срещата."],
        lines: [],
      });
    }
    if (!ownerPrices && DISCOUNT_QUESTION.test(text) && missing("Граници на отстъпките")) {
      hints.push({
        key: "no-data:discount",
        kind: "no-data",
        title: "Няма данни за отстъпки",
        say: ["Най-добрите условия ще включа директно в офертата."],
        lines: [],
      });
    }
    // Ако пакетът има готов отговор за наем, той се показва от AnswerDetector (като изречение за казване).
    const hasRentAnswer = (this.pack.answers ?? []).some((a) => a.id === "rent");
    if (!hasRentAnswer && LEASING_QUESTION.test(text)) {
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
