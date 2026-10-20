import type { KnowledgePack } from "./types";

/**
 * Фактите на фирмата като кратък текст за езиковия модел (AI отговор по време на среща).
 * Само от пакета: модели с цена (тези, които реално се предлагат), условията, готовите отговори
 * и какво липсва, за да казва „ще ви го уточня“, вместо да гадае.
 */
const MAX_LENGTH = 11_000;
/** Характеристиките, по които клиентите питат най-често. */
const KEY_SPECS = /товароносимост|минимален проход|живот на батерията|зареждане|езици|размери/i;

export function aiFacts(pack: KnowledgePack): string {
  const lines: string[] = [`Фирма: ${pack.business.name}. ${pack.business.description}`];

  const offered = pack.products.filter((p) => p.price);
  if (offered.length > 0) {
    lines.push("", "Модели, които предлагаме:");
    for (const product of offered) {
      const specs = Object.values(product.specs)
        .flatMap((group) => Object.entries(group))
        .filter(([name]) => KEY_SPECS.test(name))
        .map(([name, value]) => `${name}: ${value}`);
      lines.push(`- ${product.name} (${product.code}): ${product.price}. ${product.summary}${specs.length ? ` ${specs.join("; ")}.` : ""}`);
    }
  }

  if (pack.policies.length > 0) {
    lines.push("", "Условия:");
    for (const policy of pack.policies) lines.push(`- ${policy.topic}: ${policy.text}`);
  }

  if (pack.answers?.length) {
    lines.push("", "Потвърдени отговори на чести въпроси:");
    for (const answer of pack.answers) lines.push(`- ${answer.label}: ${answer.say.join(" ")}`);
  }

  if (pack.missing.length > 0) lines.push("", `Нямаме данни за: ${pack.missing.join("; ")}.`);

  const text = lines.join("\n");
  return text.length <= MAX_LENGTH ? text : text.slice(0, MAX_LENGTH);
}
