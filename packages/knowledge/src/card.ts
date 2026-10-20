import type { Product } from "./types";

/**
 * По време на разговор има време за поглед от 1–2 секунди, не за таблица с 20 реда.
 * Картата показва най-важните характеристики, в ред на значимост за продажбата.
 */
const KEY_SPECS = [
  "Ефективност",
  "Товароносимост",
  "Покрита площ",
  "Отделения",
  "Обем на кабина",
  "Минимален проход",
  "Минимален проход (без въртене)",
  "Живот на батерията",
  "Живот на батерия",
  "Живот — почистване",
  "Ръст",
  "Степени на свобода",
  "Функции",
  "Режими",
];

export interface ProductCard {
  title: string;
  /** „Характеристика: стойност“, най-много `limit` реда. */
  lines: string[];
  sourceUrl: string;
}

export function productCard(product: Product, limit = 4): ProductCard {
  const all = new Map<string, string>();
  for (const group of Object.values(product.specs)) {
    for (const [label, value] of Object.entries(group)) {
      if (!all.has(label)) all.set(label, value);
    }
  }
  const picked = KEY_SPECS.filter((label) => all.has(label)).slice(0, limit);
  // Резервен вариант за продукти извън списъка (напр. косачка или пакет на друг клиент):
  // допълваме с първите характеристики, както са подредени в източника.
  for (const label of all.keys()) {
    if (picked.length >= Math.min(limit, 3)) break;
    if (!picked.includes(label)) picked.push(label);
  }
  const specLines = picked.map((label) => `${label}: ${all.get(label)}`);
  return {
    title: product.name,
    // Цената е първа: в разговорите това е въпросът, който идва най-често.
    lines: product.price ? [`Цена: ${product.price}`, ...specLines.slice(0, Math.max(0, limit - 1))] : specLines,
    sourceUrl: product.sourceUrl,
  };
}
