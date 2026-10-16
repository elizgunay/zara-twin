/**
 * Облачно разпознаване за сравнение и за слаби компютри (Speechmatics, регион в ЕС).
 * По подразбиране е изключено: звукът остава на компютъра, докато ръководителят
 * изрично не избере облака в настройките.
 *
 * Ключът се пази в chrome.storage.local на този компютър. Подходящо е за пилота;
 * за клиенти ключът ще идва като временен от наш сървър, без да стои в разширението.
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

export function isCloudStt(value: unknown): value is CloudStt {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.provider === "speechmatics" && typeof record.apiKey === "string" && record.apiKey.length >= 16;
}
