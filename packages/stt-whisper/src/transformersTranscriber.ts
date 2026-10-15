import { env, pipeline } from "@huggingface/transformers";
import type { Transcriber } from "./whisperProvider";

/**
 * Истинският модел чрез transformers.js (ONNX). Една и съща библиотека работи
 * в Node (за измерванията) и в браузъра (за разширението).
 * Моделът се сваля веднъж от Hugging Face и се кешира. Звукът не се изпраща никъде.
 */
type Precision = "fp32" | "fp16" | "q8" | "q4" | "q4f16";

export interface TransformersTranscriberOptions {
  /** Напр. "onnx-community/whisper-small". */
  model: string;
  /**
   * "q8" = квантизиран 8-битов модел: ~4 пъти по-малък и по-бърз, с малка загуба на точност.
   * Може и поотделно за частите на модела, напр. { encoder_model: "fp32", decoder_model_merged: "q4" }
   * (така работи най-добре на видеокарта).
   */
  dtype?: Precision | Record<string, Precision>;
  device?: "cpu" | "wasm" | "webgpu";
  /** Къде да се пазят свалените модели (само в Node). */
  cacheDir?: string;
  /** Напредък на свалянето: 0–100 за текущия файл. */
  onProgress?: (file: string, percent: number) => void;
}

interface AsrOutput {
  text: string;
}
type AsrPipeline = (
  audio: Float32Array,
  options: { language: string; task: "transcribe" },
) => Promise<AsrOutput | AsrOutput[]>;

interface ProgressEvent {
  status: string;
  file?: string;
  progress?: number;
}

export async function createTransformersTranscriber(
  options: TransformersTranscriberOptions,
): Promise<Transcriber> {
  if (options.cacheDir !== undefined) env.cacheDir = options.cacheDir;
  const dtype = options.dtype ?? "q8";
  const onProgress = options.onProgress;
  // Типовете на pipeline() са твърде общи; описваме само частта, която ползваме.
  const asr = (await pipeline("automatic-speech-recognition", options.model, {
    dtype,
    ...(options.device !== undefined && { device: options.device }),
    ...(onProgress && {
      progress_callback: (event: ProgressEvent) => {
        if (event.status === "progress" && event.file) onProgress(event.file, event.progress ?? 0);
      },
    }),
  } as Parameters<typeof pipeline>[2])) as unknown as AsrPipeline;

  const precision = typeof dtype === "string" ? dtype : Object.values(dtype).join("+");
  return {
    id: `${options.model.split("/").pop()}@${precision}`,
    async transcribe(audio) {
      // Езикът е зададен изрично: иначе Whisper понякога „разпознава“ руски или сръбски.
      const output = await asr(audio, { language: "bulgarian", task: "transcribe" });
      return Array.isArray(output) ? output.map((part) => part.text).join(" ") : output.text;
    },
  };
}
