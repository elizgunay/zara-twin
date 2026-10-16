import { decodeWav, downsampleToInt16, TARGET_SAMPLE_RATE } from "@zara-twin/core";
import { WorkerTranscription } from "../offscreen/workerTranscription";
import { isSttChoice } from "../stt/choices";
import { log, logLines } from "../shared/log";

// Проверка за разработчика: цялата верига на разпознаването по време на среща
// (worker, рязане по паузи, модел, филтри), но звукът идва от тестовия запис на
// парчета по 100 ms в реално време, вместо от таба и микрофона. Без chrome.* API,
// затова върви и в обикновен браузър през tools/serve-extension.mjs.
// Параметри: ?choice=cpu-small|gpu-turbo-q4f16|gpu-turbo-q4|auto&gain=0.1

const params = new URLSearchParams(location.search);
const choiceParam = params.get("choice") ?? "cpu-small";
const choice = isSttChoice(choiceParam) ? choiceParam : "cpu-small";
const gain = Number(params.get("gain") ?? "1");
const out = document.getElementById("out")!;

function show(line: string): void {
  out.textContent += `${line}\n`;
}

void (async () => {
  const wav = decodeWav(new Uint8Array(await (await fetch("selftest/sample.wav")).arrayBuffer()));
  const speech = downsampleToInt16(wav.samples.map((v) => v * gain), wav.sampleRate);
  // 1 s тишина преди и 2 s след, за да има паузи като в разговор.
  const pcm = new Int16Array(TARGET_SAMPLE_RATE + speech.length + 2 * TARGET_SAMPLE_RATE);
  pcm.set(speech, TARGET_SAMPLE_RATE);
  show(`Запис: ${(speech.length / TARGET_SAMPLE_RATE).toFixed(1)} s, вариант ${choice}, сила ×${gain}`);

  let ready = false;
  const transcription = new WorkerTranscription({
    onText: (speaker, text, latencyMs) => show(`ТЕКСТ (${speaker}, ${latencyMs ?? "?"} ms): ${text}`),
    onStatus: (tone, text) => {
      show(`статус [${tone}]: ${text}`);
      if (text.startsWith("Разпознаването на говор е включено")) ready = true;
    },
  });
  transcription.start(choice, ["microphone"]);
  while (!ready) await new Promise((r) => setTimeout(r, 200));

  const frame = TARGET_SAMPLE_RATE / 10;
  for (let offset = 0; offset < pcm.length; offset += frame) {
    transcription.write({
      source: "microphone",
      pcm: pcm.slice(offset, offset + frame),
      sampleRate: TARGET_SAMPLE_RATE,
      capturedAt: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 100));
  }
  log("проверка", "записът е подаден изцяло");
  show("Записът е подаден изцяло. Изчакайте последния текст.");
  setTimeout(() => {
    show("--- логове ---");
    show(logLines().join("\n"));
    document.title = "готово";
  }, 15_000);
})();
