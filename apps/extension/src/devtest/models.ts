import { decodeWav, downsampleToInt16, int16ToFloat32, TARGET_SAMPLE_RATE, wordErrorRate } from "@zara-twin/core";
import { UtteranceSegmenter } from "@zara-twin/stt-whisper";
import { createTransformersTranscriber } from "@zara-twin/stt-whisper/transformers";
import { configureRuntime } from "../stt/runtime";

// Проверка за разработчика: сравнява модели на процесора (WebAssembly) в браузъра.
// Записът се реже по паузи както по време на среща и всяко изказване се разпознава
// поотделно. Мери времето за разпознаване спрямо дължината на говора и грешните думи.
// Параметри: ?models=whisper-small,whisper-base&dtype=q8

const params = new URLSearchParams(location.search);
const models = (params.get("models") ?? "whisper-base,whisper-small").split(",");
const dtype = (params.get("dtype") ?? "q8") as "q8";
const out = document.getElementById("out")!;
const show = (line: string) => (out.textContent += `${line}\n`);

void (async () => {
  configureRuntime();
  const [wavBytes, reference] = await Promise.all([
    fetch("selftest/sample.wav").then((r) => r.arrayBuffer()),
    fetch("selftest/sample.txt").then((r) => r.text()),
  ]);
  const wav = decodeWav(new Uint8Array(wavBytes));
  const pcm = downsampleToInt16(wav.samples, wav.sampleRate);
  const segmenter = new UtteranceSegmenter({ sampleRate: TARGET_SAMPLE_RATE });
  const frame = TARGET_SAMPLE_RATE / 10;
  const utterances = [];
  for (let offset = 0; offset < pcm.length; offset += frame) utterances.push(...segmenter.push(pcm.slice(offset, offset + frame)));
  utterances.push(...segmenter.flush());
  const speechSeconds = pcm.length / TARGET_SAMPLE_RATE;
  show(`Запис ${speechSeconds.toFixed(1)} s, ${utterances.length} изказвания, ${navigator.hardwareConcurrency} нишки, изолация: ${self.crossOriginIsolated ? "да" : "не"}`);

  for (const name of models) {
    const loadStart = performance.now();
    const model = await createTransformersTranscriber({ model: `onnx-community/${name}`, dtype, device: "wasm" });
    await model.transcribe(new Float32Array(TARGET_SAMPLE_RATE));
    const loadSeconds = (performance.now() - loadStart) / 1000;

    const texts: string[] = [];
    const perUtterance: string[] = [];
    let busy = 0;
    for (const utterance of utterances) {
      const began = performance.now();
      texts.push((await model.transcribe(int16ToFloat32(utterance.pcm))).trim());
      const seconds = (performance.now() - began) / 1000;
      busy += seconds;
      perUtterance.push(`${(utterance.pcm.length / TARGET_SAMPLE_RATE).toFixed(1)} s → ${seconds.toFixed(1)} s`);
    }
    const hypothesis = texts.join(" ");
    const wer = wordErrorRate(reference, hypothesis);
    show(
      `\n${name} ${dtype}: зареждане ${loadSeconds.toFixed(0)} s, разпознаване ${busy.toFixed(1)} s, ` +
        `RTF ${(busy / speechSeconds).toFixed(2)}, WER ${(wer.wer * 100).toFixed(1)}%`,
    );
    show(`  по изказвания: ${perUtterance.join("; ")}`);
    show(`  текст: ${hypothesis}`);
  }
  document.title = "готово";
})();
