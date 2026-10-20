import type { KnowledgePack } from "./types";

/**
 * Речникът за разпознаването на говор (Speechmatics additional_vocab): имената на фирмата,
 * сериите и продуктите + думите от пакета с това как звучат.
 *
 * Без самостоятелни кодове с цифри: от реални разговори видяхме, че „C55“, „C30“, „S300“, „W3“
 * в речника карат числата да стават модели („55 сантиметра“ → „C55 сантиметра“) и изскачат
 * карти за роботи, за които никой не говори. Кодовете се разпознават и без речника („Т9“, „т 9“).
 */
export interface SttVocabularyItem {
  content: string;
  sounds_like?: string[];
}

const MAX_ITEMS = 1000;
const HAS_DIGIT = /\d/;

export function sttVocabulary(pack: KnowledgePack): SttVocabularyItem[] {
  const items = new Map<string, SttVocabularyItem>();
  const add = (content: string, soundsLike?: string[]) => {
    const text = content.trim();
    if (text.length < 2 || text.length > 64) return;
    // Самостоятелна дума с цифри (код) — пропуска се; многословно име („Keenon Dinerbot T9“) остава.
    if (HAS_DIGIT.test(text) && !/\s/.test(text)) return;
    const existing = items.get(text.toLowerCase());
    const sounds = [...(existing?.sounds_like ?? []), ...(soundsLike ?? [])].filter((s, i, all) => s.trim() && all.indexOf(s) === i);
    items.set(text.toLowerCase(), sounds.length ? { content: text, sounds_like: sounds } : { content: text });
  };
  add(pack.business.name);
  for (const family of pack.families) add(family.name);
  for (const product of pack.products) add(product.name);
  for (const term of pack.vocabulary ?? []) add(term.content, term.soundsLike);
  return [...items.values()].slice(0, MAX_ITEMS);
}
