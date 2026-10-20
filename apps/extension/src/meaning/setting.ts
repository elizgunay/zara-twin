import { MEANING_MODELS, type MeaningModelId } from "@zara-twin/hints";

/**
 * Разбиране по смисъл (локален модел): кой модел, или изключено. Пази се в chrome.storage.local.
 * Offscreen документът няма достъп до хранилището, затова изборът идва със съобщението за старт.
 */
export const MEANING_MODEL_KEY = "meaningModel";
export type MeaningSetting = MeaningModelId | "off";

/** По подразбиране: големият модел (по-точен). Сваля се веднъж, около 540 MB. */
export const DEFAULT_MEANING: MeaningSetting = "large";

export function isMeaningSetting(value: unknown): value is MeaningSetting {
  return value === "off" || (typeof value === "string" && Object.hasOwn(MEANING_MODELS, value));
}

export function effectiveMeaning(stored: unknown): MeaningSetting {
  return isMeaningSetting(stored) ? stored : DEFAULT_MEANING;
}
