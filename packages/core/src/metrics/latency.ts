/**
 * Закъснение: времето от изговарянето до появата на текста (цел във Фаза 1.0: под 2 секунди).
 * Гледаме не само средното, а и p90: една подсказка, закъсняла с 6 секунди, е безполезна.
 */
export interface LatencySummary {
  count: number;
  p50Ms: number;
  p90Ms: number;
  maxMs: number;
}

export function summarizeLatency(samplesMs: readonly number[]): LatencySummary {
  if (samplesMs.length === 0) {
    throw new Error("Няма измервания на закъснението.");
  }
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p90Ms: percentile(sorted, 0.9),
    maxMs: sorted[sorted.length - 1]!,
  };
}

/** Метод „най-близък ранг“: винаги връща реално измерена стойност. */
function percentile(sorted: readonly number[], p: number): number {
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.max(0, rank - 1)]!;
}
