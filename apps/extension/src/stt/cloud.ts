/**
 * Облачно разпознаване (Speechmatics, регион в ЕС). По подразбиране е облакът, когато има ключ:
 * въведен в настройките или вграден при изграждането от SPEECHMATICS_API_KEY в .env.
 * Без ключ остава разпознаването на компютъра. Изричен избор в настройките винаги печели.
 *
 * Вграденият ключ е в самото разширение: давайте изградената папка само на доверени хора.
 * За клиенти ключът ще идва като временен от наш сървър, без да стои в разширението.
 */
export type SttMode = "local" | "speechmatics";

export interface CloudStt {
  provider: "speechmatics";
  apiKey: string;
}

export const STT_MODE_STORAGE_KEY = "sttMode";
export const SPEECHMATICS_KEY_STORAGE_KEY = "speechmaticsApiKey";

/** Регионът на Speechmatics в ЕС (Р22): eu1 за партиди, eu.rt.speechmatics.com на живо. */
export const SPEECHMATICS_REGION = "eu1";
export const SPEECHMATICS_REALTIME_URL = "wss://eu.rt.speechmatics.com/v2";
export const SPEECHMATICS_TEMP_KEY_URL = "https://mp.speechmatics.com/v1/api_keys?type=rt";

export function isSttMode(value: unknown): value is SttMode {
  return value === "local" || value === "speechmatics";
}

/** Ключът, който ще се ползва: въведеният в настройките, иначе вграденият. */
export function effectiveKey(storedKey: unknown, builtInKey: string): string {
  const stored = typeof storedKey === "string" ? storedKey.trim() : "";
  return stored || builtInKey.trim();
}

/** Изборът: изричният от настройките, иначе облакът, ако има ключ. */
export function effectiveMode(storedMode: unknown, key: string): SttMode {
  if (isSttMode(storedMode)) return storedMode;
  return key ? "speechmatics" : "local";
}

/** Какво получава offscreen документът: облак с ключ или null (на компютъра). */
export function resolveCloudStt(storedMode: unknown, storedKey: unknown, builtInKey: string): CloudStt | null {
  const apiKey = effectiveKey(storedKey, builtInKey);
  return effectiveMode(storedMode, apiKey) === "speechmatics" && apiKey ? { provider: "speechmatics", apiKey } : null;
}

export function isCloudStt(value: unknown): value is CloudStt {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.provider === "speechmatics" && typeof record.apiKey === "string" && record.apiKey.length >= 16;
}
