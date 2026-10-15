import type { TransformersTranscriberOptions } from "@zara-twin/stt-whisper/transformers";

/**
 * Вариантите за разпознаване на говор в браузъра. Тестът на компютъра избира най-бързия
 * и го запомня. Copilot го ползва при следващата среща. Без тест: „auto“ по видеокартата.
 */
export type SttChoiceKey = "gpu-turbo-q4f16" | "gpu-turbo-q4" | "cpu-small";
export type SttChoice = SttChoiceKey | "auto";

export const STT_CHOICES: Record<SttChoiceKey, { label: string; downloadMb: number; options: TransformersTranscriberOptions }> = {
  "gpu-turbo-q4f16": {
    label: "Видеокарта, whisper-large-v3-turbo (16-битов)",
    downloadMb: 540,
    options: {
      model: "onnx-community/whisper-large-v3-turbo",
      dtype: { encoder_model: "q4f16", decoder_model_merged: "q4f16" },
      device: "webgpu",
    },
  },
  "gpu-turbo-q4": {
    label: "Видеокарта, whisper-large-v3-turbo",
    downloadMb: 720,
    options: {
      model: "onnx-community/whisper-large-v3-turbo",
      dtype: { encoder_model: "q4", decoder_model_merged: "q4" },
      device: "webgpu",
    },
  },
  "cpu-small": {
    label: "Процесор, whisper-small",
    downloadMb: 240,
    options: { model: "onnx-community/whisper-small", dtype: "q8", device: "wasm" },
  },
};

export const STT_CHOICE_STORAGE_KEY = "sttChoice";

export function isSttChoice(value: unknown): value is SttChoice {
  // Object.hasOwn, а не `in`: иначе „toString“ минава като валиден вариант.
  return value === "auto" || (typeof value === "string" && Object.hasOwn(STT_CHOICES, value));
}

export interface GpuCapabilities {
  available: boolean;
  f16: boolean;
}

/** Без тест на компютъра: най-добрият вариант, който видеокартата поддържа. */
export function resolveAuto(gpu: GpuCapabilities): SttChoiceKey {
  if (!gpu.available) return "cpu-small";
  return gpu.f16 ? "gpu-turbo-q4f16" : "gpu-turbo-q4";
}

/** От резултатите на теста: вариантът с най-малко закъснение на живо. */
export function pickBest(results: { key: SttChoiceKey; latencySeconds: number }[]): SttChoiceKey | null {
  const valid = results.filter((r) => Number.isFinite(r.latencySeconds));
  if (valid.length === 0) return null;
  return valid.reduce((best, r) => (r.latencySeconds < best.latencySeconds ? r : best)).key;
}
