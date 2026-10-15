import { env } from "@huggingface/transformers";
import type { GpuCapabilities } from "./choices";

/**
 * Общи настройки за модела в браузъра (тест на компютъра и offscreen документа).
 * Двоичните файлове на ONNX Runtime са вградени в разширението: MV3 забранява код от чужди
 * сървъри. Свалят се само файловете на модела (данни), веднъж, и се пазят в кеша на браузъра.
 * Кешът е общ за всички страници на разширението, затова моделът от теста се преизползва.
 */
export function configureRuntime(): void {
  env.allowLocalModels = false;
  // Работи и в страница, и в worker: и двата са в корена на разширението.
  env.backends.onnx.wasm!.wasmPaths = new URL("ort/", self.location.href).href;
  env.backends.onnx.wasm!.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  // Вграденият „proxy“ режим на ONNX Runtime не работи в нашата сборка (не намира своя worker).
  // Затова по време на среща цялото разпознаване е в собствен worker (stt-worker.ts).
  env.backends.onnx.wasm!.proxy = false;
}

export interface GpuInfo extends GpuCapabilities {
  description: string;
}

interface Adapter {
  features: { has(name: string): boolean };
  info?: { vendor?: string; architecture?: string; description?: string };
}

/** Иска мощната видеокарта (при лаптопи с две). На Mac: чипът на Apple през Metal. */
export async function detectGpu(): Promise<GpuInfo> {
  const none = { available: false, f16: false, description: "" };
  const gpu = (self.navigator as unknown as { gpu?: { requestAdapter(o?: object): Promise<Adapter | null> } }).gpu;
  if (!gpu) return none;
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return none;
    const info = adapter.info ?? {};
    const description = [info.vendor, info.architecture, info.description].filter(Boolean).join(" · ");
    return { available: true, f16: adapter.features.has("shader-f16"), description };
  } catch {
    return none;
  }
}
