// Измерва локален Whisper върху WAV запис: точност (WER), скорост и очаквано закъснение на живо.
//
// Употреба:
//   npm run bench:stt -- --audio data/bench/tts-bg.wav --reference data/bench/tts-bg.txt
//   npm run bench:stt -- --audio запис.wav --model onnx-community/whisper-base
//
// Резултатите се записват в data/bench/results/ (папката е в .gitignore: съдържа текст от разговори).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  downsampleToInt16,
  summarizeLatency,
  TARGET_SAMPLE_RATE,
  wordErrorRate,
  type SttSegment,
} from "@zara-twin/core";
import { DEFAULT_SEGMENTER, WhisperLocalProvider, type Transcriber } from "@zara-twin/stt-whisper";
import { createTransformersTranscriber, type TransformersTranscriberOptions } from "@zara-twin/stt-whisper/transformers";
import { decodeWav } from "./wav";

const TARGET_WER = 0.15;
const TARGET_LATENCY_MS = 2000;

const { values } = parseArgs({
  options: {
    audio: { type: "string" },
    reference: { type: "string" },
    model: { type: "string", default: "onnx-community/whisper-small" },
    dtype: { type: "string", default: "q8" },
  },
});

if (values.audio === undefined) {
  console.error("Употреба: npm run bench:stt -- --audio <файл.wav> [--reference <текст.txt>] [--model <модел>] [--dtype q8|q4|fp32]");
  process.exit(1);
}

const projectRoot = resolve(import.meta.dirname, "../../..");
const dtype = values.dtype as NonNullable<TransformersTranscriberOptions["dtype"]>;

const wav = decodeWav(await readFile(values.audio));
const pcm = downsampleToInt16(wav.samples, wav.sampleRate);
const audioMs = (pcm.length / TARGET_SAMPLE_RATE) * 1000;
console.log(`Запис: ${basename(values.audio)}, ${(audioMs / 1000).toFixed(1)} s (оригинал ${wav.sampleRate} Hz)`);

console.log(`Зареждане на ${values.model} (${dtype}). Първия път моделът се сваля...`);
const loadStart = performance.now();
const model = await createTransformersTranscriber({
  model: values.model,
  dtype,
  cacheDir: join(projectRoot, "data", "models"),
});
// Първото разпознаване е по-бавно (инициализация). Не го броим в закъснението на живо.
await model.transcribe(new Float32Array(TARGET_SAMPLE_RATE));
const loadMs = performance.now() - loadStart;

const timings: { audioMs: number; processMs: number }[] = [];
const timed: Transcriber = {
  id: model.id,
  async transcribe(audio) {
    const start = performance.now();
    const text = await model.transcribe(audio);
    timings.push({ audioMs: (audio.length / TARGET_SAMPLE_RATE) * 1000, processMs: performance.now() - start });
    return text;
  },
};

const segments: SttSegment[] = [];
const errors: Error[] = [];
const stream = await new WhisperLocalProvider(timed).openStream({
  speaker: "counterpart",
  sampleRate: TARGET_SAMPLE_RATE,
  onSegment: (segment) => segments.push(segment),
  onError: (error) => errors.push(error),
});
const frame = TARGET_SAMPLE_RATE / 10;
for (let i = 0; i < pcm.length; i += frame) {
  stream.write({ source: "tab", pcm: pcm.subarray(i, i + frame), sampleRate: TARGET_SAMPLE_RATE, capturedAt: Date.now() });
}
await stream.close();

const hypothesis = segments.map((segment) => segment.text).join(" ");
const processTotal = timings.reduce((sum, t) => sum + t.processMs, 0);
const realTimeFactor = processTotal / audioMs;
// На живо: чакаме паузата след изречението, после моделът го разпознава.
// Важи само ако компютърът смогва (RTF < 1), иначе опашката расте.
const latency = timings.length > 0
  ? summarizeLatency(timings.map((t) => DEFAULT_SEGMENTER.endSilenceMs + t.processMs))
  : null;
const reference = values.reference === undefined ? null : await readFile(values.reference, "utf8");
const wer = reference === null ? null : wordErrorRate(reference, hypothesis);

const report = {
  date: new Date().toISOString(),
  audio: basename(values.audio),
  model: model.id,
  machine: { platform: process.platform, cpus: (await import("node:os")).cpus()[0]?.model ?? "?" },
  audioSeconds: +(audioMs / 1000).toFixed(1),
  loadSeconds: +(loadMs / 1000).toFixed(1),
  utterances: timings.length,
  realTimeFactor: +realTimeFactor.toFixed(2),
  estimatedLiveLatencyMs: latency,
  wer,
  errors: errors.map((error) => error.message),
  hypothesis,
  segments: segments.map(({ startMs, endMs, text }) => ({ startMs, endMs, text })),
};

const resultsDir = join(projectRoot, "data", "bench", "results");
await mkdir(resultsDir, { recursive: true });
const stamp = report.date.replace(/[:.]/g, "-");
const resultFile = join(resultsDir, `${stamp}_${model.id.replace(/[^\w.@-]/g, "_")}.json`);
await writeFile(resultFile, JSON.stringify(report, null, 2), "utf8");

const ok = (pass: boolean) => (pass ? "✅" : "❌");
console.log("\n──────── Резултат ────────");
console.log(`Модел:                ${model.id}`);
console.log(`Зареждане:            ${report.loadSeconds} s`);
console.log(`Изказвания:           ${report.utterances}`);
console.log(`Скорост (RTF):        ${report.realTimeFactor} ${ok(realTimeFactor < 1)} (под 1 = смогва на живо)`);
if (latency) {
  console.log(
    `Закъснение на живо:   p50 ${Math.round(latency.p50Ms)} ms, p90 ${Math.round(latency.p90Ms)} ms ${ok(latency.p90Ms < TARGET_LATENCY_MS)} (цел: под ${TARGET_LATENCY_MS} ms)`,
  );
}
if (wer) {
  console.log(
    `Точност (WER):        ${(wer.wer * 100).toFixed(1)}% ${ok(wer.wer < TARGET_WER)} (цел: под ${TARGET_WER * 100}%; замени ${wer.substitutions}, изпуснати ${wer.deletions}, добавени ${wer.insertions} от ${wer.referenceWords} думи)`,
  );
}
if (errors.length > 0) console.log(`Грешки:               ${errors.length}`);
console.log(`\nРазпознат текст:\n${hypothesis}`);
console.log(`\nПълен отчет: ${resultFile}`);
