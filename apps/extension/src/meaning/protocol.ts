import type { MeaningMatch, MeaningModelId } from "@zara-twin/hints";

/** Съобщенията между offscreen документа (или настройките) и worker-а с модела за смисъл. */
export type ToMeaningWorker =
  | { type: "load"; model: MeaningModelId }
  | { type: "match"; id: number; text: string };

export type FromMeaningWorker =
  | { type: "log"; line: string }
  /** Сваляне на модела (само първия път): процент за файла на модела. */
  | { type: "progress"; percent: number }
  /** Фразите от пакета: done от total (първия път се смятат, после идват от кеша). */
  | { type: "indexing"; done: number; total: number }
  | { type: "ready"; sentences: number; ms: number }
  | { type: "error"; text: string }
  | { type: "match"; id: number; match: MeaningMatch | null };
