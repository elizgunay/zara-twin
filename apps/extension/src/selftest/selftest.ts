import { decodeWav, downsampleToInt16, int16ToFloat32, TARGET_SAMPLE_RATE, wordErrorRate } from "@zara-twin/core";
import { createTransformersTranscriber, type TransformersTranscriberOptions } from "@zara-twin/stt-whisper/transformers";
import { pickBest, resolveAuto, STT_CHOICE_STORAGE_KEY, STT_CHOICES, type SttChoiceKey } from "../stt/choices";
import { configureRuntime, detectGpu, type GpuInfo } from "../stt/runtime";
import { liveLatencySeconds, VERDICT_LABEL, verdictForLatency } from "./verdict";

// Тест на компютъра: същият модел и същата библиотека, които ще работят в разширението
// (вариант A, в браузъра). Работи на Windows и на Mac, в Chrome или Edge.

interface TestPlan {
  key: SttChoiceKey;
  name: string;
  options: TransformersTranscriberOptions;
}

/** Дължина на „изречението“, с което мерим закъснението на живо. */
const UTTERANCE_SECONDS = 5;

const CPU_TEST: TestPlan = { key: "cpu-small", name: "Процесор (WASM)", options: STT_CHOICES["cpu-small"].options };

function gpuTest(gpu: GpuInfo): TestPlan {
  // С 16-битови изчисления моделът е по-малък (≈ 540 MB) и по-бърз; иначе 4-битов (≈ 720 MB).
  const key = resolveAuto(gpu);
  return { key, name: "Видеокарта (WebGPU)", options: STT_CHOICES[key].options };
}


const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const start = $<HTMLButtonElement>("start");
const runCpu = $<HTMLInputElement>("run-cpu");
const runGpu = $<HTMLInputElement>("run-gpu");
const progress = $<HTMLElement>("progress");
const resultsBox = $<HTMLElement>("results");
const summaryLines: string[] = [];
const latencies: { key: SttChoiceKey; latencySeconds: number }[] = [];
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
    await rememberBest();
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
  configureRuntime();
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
  latencies.push({ key: plan.key, latencySeconds: latency });
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

/** Copilot ще ползва най-бързия вариант от теста при следващата среща. */
async function rememberBest(): Promise<void> {
  const best = pickBest(latencies);
  if (best === null) return;
  const line = `Copilot ще използва: ${STT_CHOICES[best].label}`;
  resultsBox.append(Object.assign(document.createElement("p"), { textContent: line }));
  summaryLines.push("", line);
  // Само в разширението; при проверка в обикновен браузър chrome.storage липсва.
  await globalThis.chrome?.storage?.local.set({ [STT_CHOICE_STORAGE_KEY]: best }).catch(() => {});
}

function platformName(): string {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform;
  if (/mac/i.test(platform)) return "macOS";
  if (/win/i.test(platform)) return "Windows";
  return platform || "?";
}
