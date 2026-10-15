/**
 * Присъдата от теста на компютъра. На живо Whisper получава изказвания от ~5 s;
 * закъснението ≈ паузата (0,6 s) + RTF × 5 s. RTF 0,25 → около 1,9 s, на ръба на целта от 2 s.
 */
export type Verdict = "suitable" | "borderline" | "unsuitable";

export const VERDICT_LABEL: Record<Verdict, string> = {
  suitable: "✅ Подходящ за работа на живо",
  borderline: "⚠️ На границата: подсказките ще закъсняват",
  unsuitable: "❌ Не е подходящ за работа на живо",
};

export function verdictFor(realTimeFactor: number): Verdict {
  if (realTimeFactor <= 0.25) return "suitable";
  if (realTimeFactor <= 0.5) return "borderline";
  return "unsuitable";
}

/** Очаквано закъснение на живо в секунди за изказване от 5 s. */
export function expectedLatencySeconds(realTimeFactor: number): number {
  return Math.round((0.6 + realTimeFactor * 5) * 10) / 10;
}
