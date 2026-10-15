import { env } from "@huggingface/transformers";
import { decodeWav, downsampleToInt16, int16ToFloat32, TARGET_SAMPLE_RATE, wordErrorRate } from "@zara-twin/core";
import { createTransformersTranscriber, type TransformersTranscriberOptions } from "@zara-twin/stt-whisper/transformers";
import { expectedLatencySeconds, VERDICT_LABEL, verdictFor } from "./verdict";

// Тест на компютъра: същият модел и същата библиотека, които ще работят в разширението
// (вариант A, в браузъра). Изпълнява се на компютъра на ръководителя или на клиента.

interface TestPlan {
  name: string;
  options: TransformersTranscriberOptions;
}

const CPU_TEST: TestPlan = {
  name: "Процесор (WASM)",
  options: { model: "onnx-community/whisper-small", dtype: "q8", device: "wasm" },
};
const GPU_TEST: TestPlan = {
  name: "Видеокарта (WebGPU)",
  options: {
    model: "onnx-community/whisper-large-v3-turbo",
    dtype: { encoder_model: "q4", decoder_model_merged: "q4" },
    device: "webgpu",
  },
};

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

void (async () => {
  const gpu = await hasWebGpu();
  const info = [
    `Ядра (нишки): ${navigator.hardwareConcurrency || "?"}`,
    `Памет (по данни на браузъра): ${(navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? "?"} GB или повече`,
    `Видеокарта за AI (WebGPU): ${gpu ? "има" : "няма"}`,
    `Многонишкова обработка: ${self.crossOriginIsolated ? "да" : "не"}`,
  ];
  $("device-info").replaceChildren(...info.map((line) => Object.assign(document.createElement("p"), { textContent: line })));
  summaryLines.push("Zara Copilot: тест на компютъра", ...info);
  runGpu.checked = gpu;
  runGpu.disabled = !gpu;
  if (!gpu) $("gpu-note").textContent = "Недостъпно: браузърът не вижда подходяща видеокарта.";
})();

start.addEventListener("click", async () => {
  start.disabled = true;
  runCpu.disabled = true;
  runGpu.disabled = true;
  $("results-section").hidden = false;
  try {
    const sample = await loadSample();
    const plans = [runCpu.checked && CPU_TEST, runGpu.checked && GPU_TEST].filter(Boolean) as TestPlan[];
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

  progress.textContent = `${plan.name}: разпознаване на ${Math.round(sample.seconds)} s български говор...`;
  const runStart = performance.now();
  const heard = await model.transcribe(sample.audio);
  const rtf = (performance.now() - runStart) / 1000 / sample.seconds;
  const wer = wordErrorRate(sample.reference, heard);
  const verdict = verdictFor(rtf);

  report(plan.name, [
    ["Модел", model.id],
    ["Зареждане (вкл. сваляне)", `${loadSeconds.toFixed(0)} s`],
    ["Скорост спрямо говора (RTF)", `${rtf.toFixed(2)} (под 0,25 е добре)`],
    ["Очаквано закъснение на живо", `≈ ${expectedLatencySeconds(rtf)} s (цел: под 2 s)`],
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

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}
