import { readFileSync } from "node:fs";
import { decodeWav, downsampleToInt16, TARGET_SAMPLE_RATE } from "@zara-twin/core";
import { CloudTranscription } from "../../../apps/extension/src/offscreen/cloudTranscription";

// Проверка на облачното разпознаване от разширението (същият клас), без браузър:
// Node 22 има WebSocket и fetch. Тестовият запис се подава като „микрофон“ в реално време.
// Ключът се чете от .env и не се отпечатва.
// Употреба: npx tsx tools/stt-bench/src/cloud-transcription.ts

const key = /^\s*SPEECHMATICS_API_KEY\s*=\s*(.+?)\s*$/m.exec(readFileSync(".env", "utf8"))?.[1];
if (!key) throw new Error("В .env липсва SPEECHMATICS_API_KEY.");

const wav = decodeWav(new Uint8Array(readFileSync("apps/extension/static/selftest/sample.wav")));
const pcm = downsampleToInt16(wav.samples, wav.sampleRate);
const began = Date.now();
const at = () => `${((Date.now() - began) / 1000).toFixed(1)} s`;

let ready = false;
const transcription = new CloudTranscription(
  {
    onText: (speaker, text, latencyMs) => console.log(`[${at()}] ТЕКСТ ${speaker} (${latencyMs ?? "?"} ms): ${text}`),
    onStatus: (tone, text) => {
      console.log(`[${at()}] статус ${tone}: ${text}`);
      if (text.startsWith("Разпознаването на говор е включено")) ready = true;
    },
  },
  { provider: "speechmatics", apiKey: key },
);
transcription.start(["microphone"]);
while (!ready) await new Promise((r) => setTimeout(r, 100));

const frame = TARGET_SAMPLE_RATE / 10;
for (let offset = 0; offset < pcm.length; offset += frame) {
  transcription.write({ source: "microphone", pcm: pcm.slice(offset, offset + frame), sampleRate: TARGET_SAMPLE_RATE, capturedAt: Date.now() });
  await new Promise((r) => setTimeout(r, 100));
}
await new Promise((r) => setTimeout(r, 4000));
transcription.stop();
console.log(`[${at()}] край`);
