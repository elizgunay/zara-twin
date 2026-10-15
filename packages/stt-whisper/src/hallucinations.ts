import { normalizeForWer } from "@zara-twin/core";

/**
 * Whisper е обучен и на субтитри от видеа, затова при шум или тишина понякога
 * „чува“ типични фрази от края на клипове. Те не бива да стигат до панела.
 */
const KNOWN_PHRASES = [
  "абонирайте се",
  "благодаря за гледането",
  "благодаря ви за гледането",
  "субтитри",
  "субтитрите са направени",
  "продължава",
  "музика",
].map((phrase) => normalizeForWer(phrase).join(" "));

export function isLikelyHallucination(text: string): boolean {
  const normalized = normalizeForWer(text).join(" ");
  if (normalized.length === 0) return true;
  // Само пълно съвпадение: „Продължава ли гаранцията?“ е истински въпрос, не халюцинация.
  return KNOWN_PHRASES.includes(normalized);
}
