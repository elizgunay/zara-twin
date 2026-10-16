import type { KnowledgePack } from "./types";

/**
 * Проверява пакет, преди да се ползва. Пакетите се пишат на ръка (или от клиента),
 * затова грешките трябва да са ясни и на български, а не да изскачат по време на среща.
 */
export function validatePack(value: unknown): KnowledgePack {
  const problems: string[] = [];
  const pack = value as KnowledgePack;
  const isText = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  const isUrl = (v: unknown) => typeof v === "string" && /^https:\/\//.test(v);

  if (typeof value !== "object" || value === null) throw new Error("Пакетът не е обект.");
  for (const field of ["id", "version"] as const) {
    if (!isText(pack[field])) problems.push(`Липсва „${field}“.`);
  }
  if (!isText(pack.business?.name)) problems.push("Липсва името на бизнеса.");
  if (!Array.isArray(pack.products) || pack.products.length === 0) problems.push("Няма продукти.");
  if (!Array.isArray(pack.families)) problems.push("Липсва списък с продуктови серии.");
  if (!Array.isArray(pack.missing)) problems.push("Липсва списъкът „missing“ (може да е празен).");
  if (pack.pricing !== undefined && pack.pricing !== "owner") problems.push("„pricing“ може да е само „owner“.");

  const familyIds = new Set((pack.families ?? []).map((f) => f.id));
  const seenIds = new Set<string>();
  const seenCodes = new Set<string>();
  for (const [index, product] of (pack.products ?? []).entries()) {
    const where = `Продукт №${index + 1} (${product?.id ?? "?"})`;
    if (!isText(product.id) || !isText(product.name) || !isText(product.code)) {
      problems.push(`${where}: липсва id, име или код.`);
      continue;
    }
    if (seenIds.has(product.id)) problems.push(`${where}: повторено id.`);
    const code = product.code.toLowerCase();
    if (seenCodes.has(code)) problems.push(`${where}: кодът ${product.code} се повтаря, разпознаването в разговора става двусмислено.`);
    if (!/^[a-z]+\d+[a-z]*$/i.test(product.code)) problems.push(`${where}: кодът трябва да е букви + цифри, напр. C40S.`);
    if (!familyIds.has(product.familyId)) problems.push(`${where}: непозната серия „${product.familyId}“.`);
    if (!isUrl(product.sourceUrl)) problems.push(`${where}: липсва източник (https://…).`);
    seenIds.add(product.id);
    seenCodes.add(code);
  }
  for (const fact of [...(pack.policies ?? []), ...(pack.faq ?? [])]) {
    if (!isUrl(fact.sourceUrl)) problems.push(`Факт без източник: „${"topic" in fact ? fact.topic : fact.question}“.`);
  }

  if (problems.length > 0) {
    throw new Error(`Невалиден пакет със знания:\n- ${problems.join("\n- ")}`);
  }
  return pack;
}
