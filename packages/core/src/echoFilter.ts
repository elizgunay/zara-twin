import { normalizeForWer } from "./metrics/wer";
import type { SpeakerRole } from "./transcript";

/**
 * Ехо между двата източника. Без слушалки микрофонът чува клиента от високоговорителите,
 * а ако двамата са в една стая, срещата връща и гласа на собственика. Тогава едно и също
 * изречение идва два пъти: от микрофона и от таба, с 0,5–1 s разлика. Пазим първото.
 */
export interface EchoFilterOptions {
  /** Колко назад търсим същото изречение от другия източник. */
  windowMs?: number;
  /** Каква част от думите на по-краткото изречение трябва да съвпада (0–1). */
  minOverlap?: number;
}

interface Recent {
  speaker: SpeakerRole;
  words: Set<string>;
  at: number;
}

export class EchoFilter {
  private readonly windowMs: number;
  private readonly minOverlap: number;
  private recent: Recent[] = [];

  constructor(options: EchoFilterOptions = {}) {
    this.windowMs = options.windowMs ?? 3_000;
    this.minOverlap = options.minOverlap ?? 0.6;
  }

  /** true = изречението е ехо на току-що чуто от другия източник и не се показва. */
  isEcho(speaker: SpeakerRole, text: string, at: number): boolean {
    this.recent = this.recent.filter((item) => at - item.at <= this.windowMs);
    const words = new Set(normalizeForWer(text));
    if (words.size === 0) return false;
    // Двата източника режат изречението различно („Какви са минусите на“ / „роботите“ срещу
    // „Какви минусите на“): сравняваме и с всички думи на другия от последните секунди.
    const other = this.recent.filter((item) => item.speaker !== speaker);
    const otherWords = new Set(other.flatMap((item) => [...item.words]));
    const echo =
      other.some((item) => overlap(words, item.words) >= this.minOverlap) ||
      (words.size >= 2 && otherWords.size > 0 && overlap(words, otherWords, words.size) >= this.minOverlap);
    // Ехото не влиза в паметта, иначе би „потвърдило“ следващото истинско изречение.
    if (!echo) this.recent.push({ speaker, words, at });
    return echo;
  }
}

/** Общите думи спрямо по-краткото изречение (или спрямо base): „T8“ и „имате T8“ съвпадат напълно. */
function overlap(a: Set<string>, b: Set<string>, base = Math.min(a.size, b.size)): number {
  let common = 0;
  for (const word of a) if (b.has(word)) common++;
  return common / base;
}
