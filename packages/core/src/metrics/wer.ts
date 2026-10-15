/**
 * Word Error Rate: основният показател за точност във Фаза 1.0 (цел: под 15%).
 *
 * WER = (замени + изтривания + вмъквания) / брой думи в еталонния текст.
 * Еталонът е ръчно поправеният транскрипт, хипотезата е изходът на доставчика.
 */
export interface WerResult {
  wer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  referenceWords: number;
}

/** Малки букви, без пунктуация, единични интервали. Така „Здравейте,“ и „здравейте“ са една дума. */
export function normalizeForWer(text: string): string[] {
  return text
    .toLocaleLowerCase("bg-BG")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .split(/\s+/u)
    .filter((word) => word.length > 0);
}

export function wordErrorRate(reference: string, hypothesis: string): WerResult {
  const ref = normalizeForWer(reference);
  const hyp = normalizeForWer(hypothesis);

  if (ref.length === 0) {
    throw new Error("Еталонният текст е празен: WER не може да се изчисли.");
  }

  // cost[i][j] = минималният брой операции за превръщане на първите i думи от ref в първите j от hyp.
  const rows = ref.length + 1;
  const cols = hyp.length + 1;
  const cost: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) cost[i]![0] = i;
  for (let j = 0; j < cols; j++) cost[0]![j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const same = ref[i - 1] === hyp[j - 1];
      cost[i]![j] = Math.min(
        cost[i - 1]![j - 1]! + (same ? 0 : 1),
        cost[i - 1]![j]! + 1,
        cost[i]![j - 1]! + 1,
      );
    }
  }

  // Обратен ход, за да разделим грешките по тип.
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  let i = ref.length;
  let j = hyp.length;
  while (i > 0 || j > 0) {
    const current = cost[i]![j]!;
    if (i > 0 && j > 0 && current === cost[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      if (ref[i - 1] !== hyp[j - 1]) substitutions++;
      i--;
      j--;
    } else if (i > 0 && current === cost[i - 1]![j]! + 1) {
      deletions++;
      i--;
    } else {
      insertions++;
      j--;
    }
  }

  return {
    wer: (substitutions + deletions + insertions) / ref.length,
    substitutions,
    deletions,
    insertions,
    referenceWords: ref.length,
  };
}
