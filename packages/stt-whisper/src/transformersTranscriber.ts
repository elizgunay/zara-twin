import { env, pipeline } from "@huggingface/transformers";
import type { Transcriber } from "./whisperProvider";

/**
 * Истинският модел чрез transformers.js (ONNX). Една и съща библиотека работи
 * в Node (за измерванията) и в браузъра (за разширението).
 * Моделът се сваля веднъж от Hugging Face и се кешира. Звукът не се изпраща никъде.
 */
export interface TransformersTranscriberOptions {
  /** Напр. "onnx-community/whisper-small". */
  model: string;
  /** "q8" = квантизиран 8-битов модел: ~4 пъти по-малък и по-бърз, с малка загуба на точност. */
  dtype?: "fp32" | "fp16" | "q8" | "q4";
  device?: "cpu" | "wasm" | "webgpu";
  /** Къде да се пазят свалените модели (само в Node). */
  cacheDir?: string;
}

interface AsrOutput {
  text: string;
}
type AsrPipeline = (
  audio: Float32Array,
  options: { language: string; task: "transcribe" },
) => Promise<AsrOutput | AsrOutput[]>;

export async function createTransformersTranscriber(
  options: TransformersTranscriberOptions,
): Promise<Transcriber> {
  if (options.cacheDir !== undefined) env.cacheDir = options.cacheDir;
  const dtype = options.dtype ?? "q8";
  // Типовете на pipeline() са твърде общи; описваме само частта, която ползваме.
  const asr = (await pipeline("automatic-speech-recognition", options.model, {
    dtype,
    ...(options.device !== undefined && { device: options.device }),
  })) as unknown as AsrPipeline;

  return {
    id: `${options.model.split("/").pop()}@${dtype}`,
    async transcribe(audio) {
      // Езикът е зададен изрично: иначе Whisper понякога „разпознава“ руски или сръбски.
      const output = await asr(audio, { language: "bulgarian", task: "transcribe" });
      return Array.isArray(output) ? output.map((part) => part.text).join(" ") : output.text;
    },
  };
}
