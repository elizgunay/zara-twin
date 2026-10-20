import type { KnowledgePack, MethodPack } from "@zara-twin/knowledge";
import type { AnswerDetector } from "./answers";
import type { Hint } from "./engine";
import type { ObjectionDetector } from "./objections";

/**
 * Разпознаване по смисъл, когато фразите от пакета не съвпаднат („Колко ще ми излезе?“
 * вместо „колко струва“). Локален модел превръща изреченията във вектори; изречението на
 * клиента се сравнява с фразите и примерите от пакета и с „нищо особено“ (поздрави, „добре“).
 *
 * Тук няма модел: той се подава като функция embed, затова логиката се тества без него.
 * Не измисля отговори: показва само готовия отговор или възражение от пакета.
 */
export type Embed = (texts: string[]) => Promise<number[][]>;

export interface MeaningIntent {
  kind: "answer" | "objection" | "neutral";
  id: string;
  texts: string[];
}

export interface MeaningMatch {
  kind: "answer" | "objection";
  id: string;
  /** Близост до най-близкото изречение (косинус, 0–1). */
  score: number;
  /** Колко е по-близо от следващата тема и от „нищо особено“. По това се решава дали да се покаже. */
  margin: number;
}

export interface MeaningOptions {
  /**
   * Най-малкият отстъп пред следващата тема. По-голям = по-малко, но по-сигурни подсказки.
   * 0,02 е измерено (tools/stt-bench/src/meaning-bench.ts): без грешни подсказки на тестовите изречения.
   */
  minMargin?: number;
  /** По-кратки изречения („Да, добре.“) не се разпознават по смисъл. */
  minWords?: number;
  /**
   * За фразите от пакета: напр. същият модел с кеш на диска, за да не се смятат на всяка среща.
   * Изреченията от разговора минават само през embed и не се пазят никъде.
   */
  buildEmbed?: Embed;
}

const BATCH = 16;

/**
 * Безплатните локални модели (Hugging Face, ONNX, 8-битови). Свалят се веднъж и се пазят в браузъра.
 * multilingual-e5 иска „query: “ пред всяко изречение. Измерено на български перифрази:
 * малкият хваща около 1/3 от тях, големият над половината, и двата без грешни подсказки при отстъп 0,02–0,03.
 */
export const MEANING_MODELS = {
  small: { id: "Xenova/multilingual-e5-small", prefix: "query: ", sizeMb: 113, minMargin: 0.03 },
  large: { id: "Xenova/multilingual-e5-large", prefix: "query: ", sizeMb: 536, minMargin: 0.02 },
} as const;
export type MeaningModelId = keyof typeof MEANING_MODELS;

/** Темите от пакета: отговорите и възраженията с техните фрази и примери + „нищо особено“. */
export function meaningIntents(pack: KnowledgePack, method: MethodPack): MeaningIntent[] {
  return [
    ...(pack.answers ?? []).map((a) => ({ kind: "answer" as const, id: a.id, texts: [a.label, ...a.triggers, ...(a.examples ?? [])] })),
    ...method.objections.map((o) => ({
      kind: "objection" as const,
      id: o.id,
      texts: [o.label.replace(/[„“"]/g, ""), ...o.triggers, ...(o.examples ?? [])],
    })),
    ...(method.neutralExamples?.length ? [{ kind: "neutral" as const, id: "neutral", texts: method.neutralExamples }] : []),
  ];
}

export class MeaningIndex {
  private constructor(
    private readonly entries: { intent: MeaningIntent; vector: number[] }[],
    private readonly embed: Embed,
    private readonly minMargin: number,
    private readonly minWords: number,
  ) {}

  /** Превръща всички фрази в вектори веднъж, при старта на срещата. */
  static async build(intents: MeaningIntent[], embed: Embed, options: MeaningOptions = {}): Promise<MeaningIndex> {
    const items = intents.flatMap((intent) => intent.texts.map((text) => ({ intent, text })));
    const entries: { intent: MeaningIntent; vector: number[] }[] = [];
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      const vectors = await (options.buildEmbed ?? embed)(batch.map((item) => item.text));
      batch.forEach((item, j) => entries.push({ intent: item.intent, vector: vectors[j]! }));
    }
    return new MeaningIndex(entries, embed, options.minMargin ?? 0.02, options.minWords ?? 3);
  }

  get size(): number {
    return this.entries.length;
  }

  async match(text: string): Promise<MeaningMatch | null> {
    if (text.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length < this.minWords) return null;
    const [query] = await this.embed([text]);
    if (!query) return null;
    // Най-близкото изречение за всяка тема.
    const best = new Map<MeaningIntent, number>();
    for (const { intent, vector } of this.entries) {
      const score = dot(query, vector);
      if (score > (best.get(intent) ?? -Infinity)) best.set(intent, score);
    }
    const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
    const [first, second] = ranked;
    if (!first || first[0].kind === "neutral") return null;
    const margin = first[1] - (second?.[1] ?? 0);
    if (margin < this.minMargin) return null;
    return { kind: first[0].kind, id: first[0].id, score: first[1], margin };
  }
}

/** Готовата подсказка за разпознатата тема, с паузите срещу повторения на детекторите. */
export function meaningHints(match: MeaningMatch, answers: AnswerDetector, objections: ObjectionDetector): Hint[] {
  const hints = match.kind === "answer" ? answers.show(match.id) : objections.show(match.id);
  return hints.map((hint) => ({ ...hint, byMeaning: true }));
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}
