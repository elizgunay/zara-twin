import type { SpeakerRole } from "@zara-twin/core";

/**
 * Слепва парчетата от разпознаването в изречения. Облакът праща по дума-две и при
 * естествена пауза изречението се къса („Да се уговорим за“ / „среща“ / „за 21-ви“).
 * Парче от същия човек, дошло до gapMs след предишното, което не завършва с точка,
 * продължава същия ред. Друг говорител или по-дълга пауза започва нов ред.
 */
export interface MergeResult {
  /** Целият текст на реда досега (с новото парче). */
  text: string;
  /** true: продължава предишния ред; false: нов ред. */
  merged: boolean;
}

const SENTENCE_END = /[.!?…]["“”»]?$/u;
/** Над толкова знака редът се затваря, дори без точка: дълъг монолог не става един ред. */
const MAX_LINE = 400;

export class UtteranceMerger {
  private last: { speaker: SpeakerRole; text: string; at: number } | null = null;

  constructor(private readonly gapMs = 2_500) {}

  add(speaker: SpeakerRole, piece: string, at: number): MergeResult {
    const text = piece.trim();
    const last = this.last;
    if (last && last.speaker === speaker && at - last.at <= this.gapMs && !SENTENCE_END.test(last.text) && last.text.length < MAX_LINE) {
      // Препинателен знак се лепи без интервал; иначе с интервал.
      last.text = /^[,.!?;:…]/.test(text) ? `${last.text}${text}` : `${last.text} ${text}`;
      last.at = at;
      return { text: last.text, merged: true };
    }
    this.last = { speaker, text, at };
    return { text, merged: false };
  }
}
