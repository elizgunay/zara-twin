import type { KnowledgePack, Product, ProductFamily } from "./types";

/**
 * Разпознава кои продукти се споменават в изречение от разговора, за да покаже
 * Copilot-ът характеристиките им на момента („C40S: до 1 100 м²/ч, проход 65 см“).
 *
 * Разпознаването на говор пише кодовете по различни начини: „C40S“, „C 40 S“,
 * „С40С“ (кирилица), „т10“. Затова всяка буква на кода приема и кирилския си двойник,
 * а между буквите и цифрите може да има интервал или тире.
 */
export interface Mentions {
  products: Product[];
  /** Серии, споменати без конкретен модел („клийнбот“). */
  families: ProductFamily[];
}

/** Кирилски букви, които звучат или изглеждат като латинските в кодовете на моделите. */
const LETTER_VARIANTS: Record<string, string> = {
  a: "aа",
  b: "bб",
  c: "cсц",
  d: "dд",
  e: "eе",
  f: "fф",
  k: "kк",
  m: "mм",
  p: "pп",
  r: "rр",
  s: "sс",
  t: "tт",
  w: "wв",
  x: "xх",
};

const BOUNDARY_BEFORE = "(?<![\\p{L}\\p{N}])";
const BOUNDARY_AFTER = "(?![\\p{L}\\p{N}])";

/**
 * „C40S“ → C, 40, S (наставката е по избор).
 * Интервал или тире между буквите и цифрите („C 40 S“) се допуска само при латиница.
 * При кирилица не: „в 3 часа“, „с 100 стаи“ и „с 300 кг“ са предлози, не модели W3, S100, S300.
 */
export function codePattern(code: string): RegExp {
  const parts = code.toLowerCase().match(/^([a-z]+)(\d+)([a-z]*)$/);
  if (!parts) throw new Error(`Невалиден код на модел: ${code}`);
  const [, prefix, digits, suffix] = parts;
  const sep = "[\\s-]?";
  const cyrillic = (text: string) =>
    [...text].map((ch) => `[${(LETTER_VARIANTS[ch] ?? ch).slice(1) || ch}]`).join("");
  const either = (text: string, beforeDigits: boolean) =>
    beforeDigits
      ? `(?:${text}${sep}|${cyrillic(text)})`
      : `(?:${sep}${text}|${cyrillic(text)})`;
  const head = either(prefix!, true);
  const tail = suffix ? `${either(suffix, false)}?` : "";
  return new RegExp(`${BOUNDARY_BEFORE}${head}${digits}${tail}${BOUNDARY_AFTER}`, "iu");
}

function aliasPattern(alias: string): RegExp {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`${BOUNDARY_BEFORE}${escaped}\\p{L}{0,3}${BOUNDARY_AFTER}`, "iu");
}

export class MentionFinder {
  private readonly productMatchers: { product: Product; pattern: RegExp }[];
  private readonly familyMatchers: { family: ProductFamily; patterns: RegExp[] }[];

  constructor(private readonly pack: KnowledgePack) {
    this.productMatchers = pack.products.map((product) => ({ product, pattern: codePattern(product.code) }));
    // По-дългите псевдоними първи не са нужни: търсим съвпадение, не най-дълго.
    this.familyMatchers = pack.families.map((family) => ({ family, patterns: family.aliases.map(aliasPattern) }));
  }

  find(text: string): Mentions {
    const products = this.productMatchers
      .map(({ product, pattern }) => ({ product, index: text.search(pattern) }))
      .filter(({ index }) => index >= 0)
      .sort((a, b) => a.index - b.index)
      .map(({ product }) => product);

    const mentionedFamilies = new Set(products.map((p) => p.familyId));
    const families = this.familyMatchers
      .filter(({ family, patterns }) => !mentionedFamilies.has(family.id) && patterns.some((p) => p.test(text)))
      .map(({ family }) => family);

    return { products, families };
  }

  productsOf(family: ProductFamily): Product[] {
    return this.pack.products.filter((p) => p.familyId === family.id);
  }
}
