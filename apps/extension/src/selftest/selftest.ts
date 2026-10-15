import { env } from "@huggingface/transformers";
import { decodeWav, downsampleToInt16, int16ToFloat32, TARGET_SAMPLE_RATE, wordErrorRate } from "@zara-twin/core";
import { createTransformersTranscriber, type TransformersTranscriberOptions } from "@zara-twin/stt-whisper/transformers";
import { liveLatencySeconds, VERDICT_LABEL, verdictForLatency } from "./verdict";

// Тест на компютъра: същият модел и същата библиотека, които ще работят в разширението
// (вариант A, в браузъра). Работи на Windows и на Mac, в Chrome или Edge.

interface TestPlan {
  name: string;
  options: TransformersTranscriberOptions;
}

interface GpuInfo {
  available: boolean;
  /** 16-битови изчисления (shader-f16): Apple Silicon и повечето съвременни видеокарти. */
  f16: boolean;
  description: string;
}

/** Дължина на „изречението“, с което мерим закъснението на живо. */
const UTTERANCE_SECONDS = 5;

const CPU_TEST: TestPlan = {
  name: "Процесор (WASM)",
  options: { model: "onnx-community/whisper-small", dtype: "q8", device: "wasm" },
};

function gpuTest(gpu: GpuInfo): TestPlan {
  // С 16-битови изчисления моделът е по-малък (≈ 540 MB) и по-бърз; иначе 4-битов (≈ 720 MB).
  const precision = gpu.f16 ? "q4f16" : "q4";
  return {
    name: "Видеокарта (WebGPU)",
    options: {
      model: "onnx-community/whisper-large-v3-turbo",
      dtype: { encoder_model: precision, decoder_model_merged: precision },
      device: "webgpu",
    },
  };
}

// Двоичните файлове на ONNX Runtime са вградени в разширението: MV3 забранява код от чужди сървъри.
env.allowLocalModels = false;
env.backends.onnx.wasm!.wasmPaths = new URL("ort/", location.href).href;
env.backends.onnx.wasm!.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const start = $<HTMLButtonElement>("start");
const runCpu = $<HTMLInputElement>("run-cpu");
const runGpu = $<HTMLInputElement>("run-gpu");
const progress = $<HTMLElement>("progress");
const resultsBox = $<HTMLElement>("results");
const summaryLines: string[] = [];
let gpuInfo: GpuInfo = { available: false, f16: false, description: "" };

void (async () => {
  gpuInfo = await detectGpu();
  const info = [
    `Система: ${platformName()}`,
    `Ядра (нишки): ${navigator.hardwareConcurrency || "?"}`,
    `Памет (по данни на браузъра): ${(navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? "?"} GB или повече`,
    `Видеокарта за AI (WebGPU): ${gpuInfo.available ? gpuInfo.description || "има" : "няма"}`,
    `16-битови изчисления на видеокартата: ${gpuInfo.f16 ? "да" : "не"}`,
    `Многонишкова обработка: ${self.crossOriginIsolated ? "да" : "не"}`,
  ];
  $("device-info").replaceChildren(...info.map((line) => Object.assign(document.createElement("p"), { textContent: line })));
  summaryLines.push("Zara Copilot: тест на компютъра", ...info);
  runGpu.checked = gpuInfo.available;
  runGpu.disabled = !gpuInfo.available;
  $("gpu-note").textContent = gpuInfo.available
    ? `whisper-large-v3-turbo, сваляне ≈ ${gpuInfo.f16 ? 540 : 720} MB`
    : "Недостъпно: браузърът не вижда подходяща видеокарта.";
})();

start.addEventListener("click", async () => {
  start.disabled = true;
  runCpu.disabled = true;
  runGpu.disabled = true;
  $("results-section").hidden = false;
  try {
    const sample = await loadSample();
    const plans = [runCpu.checked && CPU_TEST, runGpu.checked && gpuTest(gpuInfo)].filter(Boolean) as TestPlan[];
    for (const plan of plans) await runTest(plan, sample);
    progress.textContent = "Тестът приключи.";
  } catch (error) {
    progress.textContent = `Грешка: ${error instanceof Error ? error.message : error}`;
    progress.className = "error";
  }
});

$("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(summaryLines.join("\n"));
  $<HTMLButtonElement>("copy").textContent = "Копирано";
});

async function loadSample(): Promise<{ audio: Float32Array; reference: string; seconds: number }> {
  const [wavBytes, reference] = await Promise.all([
    fetch("selftest/sample.wav").then((r) => r.arrayBuffer()),
    fetch("selftest/sample.txt").then((r) => r.text()),
  ]);
  const wav = decodeWav(new Uint8Array(wavBytes));
  const audio = int16ToFloat32(downsampleToInt16(wav.samples, wav.sampleRate));
  return { audio, reference, seconds: audio.length / TARGET_SAMPLE_RATE };
}

async function runTest(plan: TestPlan, sample: { audio: Float32Array; reference: string; seconds: number }) {
  progress.className = "";
  progress.textContent = `${plan.name}: зареждане на модела...`;
  const loadStart = performance.now();
  let model;
  try {
    model = await createTransformersTranscriber({
      ...plan.options,
      onProgress: (file, percent) => {
        progress.textContent = `${plan.name}: сваляне на ${file.split("/").pop()}: ${Math.round(percent)}%`;
      },
    });
    progress.textContent = `${plan.name}: подготовка...`;
    await model.transcribe(new Float32Array(TARGET_SAMPLE_RATE)); // първото пускане е по-бавно
  } catch (error) {
    report(plan.name, [["Грешка", `Моделът не тръгна: ${error instanceof Error ? error.message : error}`, "error"]]);
    return;
  }
  const loadSeconds = (performance.now() - loadStart) / 1000;

  // 1. Точност: целият запис.
  progress.textContent = `${plan.name}: разпознаване на ${Math.round(sample.seconds)} s български говор...`;
  const fullStart = performance.now();
  const heard = await model.transcribe(sample.audio);
  const rtf = (performance.now() - fullStart) / 1000 / sample.seconds;
  const wer = wordErrorRate(sample.reference, heard);

  // 2. Скорост на живо: изказване от 5 s, както ще ги подава разделянето по паузи. Най-доброто от 2 опита.
  progress.textContent = `${plan.name}: мерене на изречение от ${UTTERANCE_SECONDS} s...`;
  const utterance = sample.audio.subarray(0, UTTERANCE_SECONDS * TARGET_SAMPLE_RATE);
  let utteranceSeconds = Infinity;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = performance.now();
    await model.transcribe(utterance);
    utteranceSeconds = Math.min(utteranceSeconds, (performance.now() - t) / 1000);
  }
  const latency = liveLatencySeconds(utteranceSeconds);
  const verdict = verdictForLatency(latency);

  report(plan.name, [
    ["Модел", model.id],
    ...(plan.options.device === "webgpu" ? [["Видеокарта", gpuInfo.description || "?"] as [string, string]] : []),
    ["Зареждане (вкл. сваляне)", `${loadSeconds.toFixed(0)} s`],
    [`Разпознаване на изречение от ${UTTERANCE_SECONDS} s`, `${utteranceSeconds.toFixed(2)} s`],
    ["Закъснение на живо", `≈ ${latency} s (цел: под 2 s)`],
    ["Скорост спрямо говора (RTF, 16 s запис)", rtf.toFixed(2)],
    ["Грешни думи (синтетичен глас)", `${(wer.wer * 100).toFixed(1)}% (цел: под 15%)`],
    ["Присъда", VERDICT_LABEL[verdict], verdict],
    ["Разпознато", heard.trim(), "heard"],
  ]);
}

function report(title: string, rows: [string, string, string?][]) {
  const heading = Object.assign(document.createElement("h3"), { textContent: title });
  heading.style.cssText = "font-size:15px;margin:16px 0 4px";
  const table = document.createElement("table");
  for (const [label, value, className] of rows) {
    const row = table.insertRow();
    row.append(Object.assign(document.createElement("th"), { textContent: label }));
    const cell = row.insertCell();
    cell.textContent = value;
    if (className) cell.className = className;
  }
  resultsBox.append(heading, table);
  summaryLines.push("", `== ${title}`, ...rows.map(([label, value]) => `${label}: ${value}`));
}

interface Adapter {
  features: { has(name: string): boolean };
  info?: { vendor?: string; architecture?: string; description?: string };
}

async function detectGpu(): Promise<GpuInfo> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(o?: object): Promise<Adapter | null> } }).gpu;
  if (!gpu) return { available: false, f16: false, description: "" };
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return { available: false, f16: false, description: "" };
    const info = adapter.info ?? {};
    const description = [info.vendor, info.architecture, info.description].filter(Boolean).join(" · ");
    return { available: true, f16: adapter.features.has("shader-f16"), description };
  } catch {
    return { available: false, f16: false, description: "" };
  }
}

function platformName(): string {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform;
  if (/mac/i.test(platform)) return "macOS";
  if (/win/i.test(platform)) return "Windows";
  return platform || "?";
}
