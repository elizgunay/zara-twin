/**
 * Присъдата от теста на компютъра. На живо Whisper получава изказване от няколко секунди
 * и закъснението е: паузата, по която разбираме, че изречението е свършило (0,6 s),
 * плюс времето за разпознаване на самото изказване. Затова мерим реално 5-секундно
 * изречение, а не изчисляваме от скоростта на дълъг запис (Whisper винаги обработва
 * 30-секундни прозорци, затова времето не е пропорционално на дължината).
 */
export type Verdict = "suitable" | "borderline" | "unsuitable";

export const VERDICT_LABEL: Record<Verdict, string> = {
  suitable: "✅ Подходящ за работа на живо",
  borderline: "⚠️ На границата: подсказките ще закъсняват",
  unsuitable: "❌ Не е подходящ за работа на живо",
};

/** Паузата след изречението, по която разделяме изказванията (DEFAULT_SEGMENTER.endSilenceMs). */
export const END_SILENCE_SECONDS = 0.6;

export function liveLatencySeconds(utteranceProcessingSeconds: number): number {
  return Math.round((END_SILENCE_SECONDS + utteranceProcessingSeconds) * 10) / 10;
}

/** Цел: под 2 s (Р23). До 3 s още е използваемо, но подсказката идва късно. */
export function verdictForLatency(latencySeconds: number): Verdict {
  if (latencySeconds <= 2) return "suitable";
  if (latencySeconds <= 3) return "borderline";
  return "unsuitable";
}
