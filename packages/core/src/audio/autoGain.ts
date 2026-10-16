import { rmsLevel } from "./pcm";

/**
 * Автоматично усилване за тих микрофон. Следи силата на говора (не на тишината)
 * и усилва така, че говорът да е около targetLevel. Облачните модели приемат много
 * тих звук (RMS около 0,005) за шум и не връщат текст.
 */
export interface AutoGainOptions {
  /** Желаната сила на говора (RMS). */
  targetLevel?: number;
  /** Най-голямото усилване: над него се усилва и шумът в стаята. */
  maxGain?: number;
  /** Под този праг парчето е тишина и не мени усилването. */
  silenceLevel?: number;
}

export class AutoGain {
  private readonly target: number;
  private readonly maxGain: number;
  private readonly silence: number;
  /** Плъзгаща оценка на силата на говора; null = още няма говор. */
  private speechLevel: number | null = null;

  constructor(options: AutoGainOptions = {}) {
    this.target = options.targetLevel ?? 0.06;
    this.maxGain = options.maxGain ?? 16;
    this.silence = options.silenceLevel ?? 0.0015;
  }

  get gain(): number {
    if (this.speechLevel === null) return 1;
    return Math.min(this.maxGain, Math.max(1, this.target / this.speechLevel));
  }

  /** Връща усилено копие на парчето (входът не се променя). */
  process(pcm: Int16Array): Int16Array {
    const level = rmsLevel(pcm);
    if (level >= this.silence) {
      // Бързо надолу (силен звук = веднага по-малко усилване), бавно нагоре.
      const rate = this.speechLevel === null || level > this.speechLevel ? 0.5 : 0.05;
      this.speechLevel = this.speechLevel === null ? level : this.speechLevel + (level - this.speechLevel) * rate;
    }
    const gain = this.gain;
    if (gain === 1) return pcm.slice();
    const out = new Int16Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i]! * gain)));
    return out;
  }
}
