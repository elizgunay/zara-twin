import { readFileSync } from "node:fs";
import { assertEuRegion, decodeWav, downsampleToInt16, TARGET_SAMPLE_RATE, wordErrorRate } from "@zara-twin/core";
import { UtteranceSegmenter } from "@zara-twin/stt-whisper";

// Сравнение с облака: Speechmatics, регион в ЕС (Р22), само тестовият запис.
// 1. Целият запис като една задача (партида): точност.
// 2. На живо (WebSocket): закъснение от края на изречението до текста.
// Ключът се чете от .env и никъде не се отпечатва.
// Употреба: npm.cmd run bench:speechmatics -- [--audio файл.wav --reference текст.txt]

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1]! : fallback;
};
const audioPath = option("audio", "apps/extension/static/selftest/sample.wav");
const referencePath = option("reference", "apps/extension/static/selftest/sample.txt");

const env = readEnv(".env");
const apiKey = env.SPEECHMATICS_API_KEY ?? "";
const region = env.SPEECHMATICS_REGION || "eu1";
if (!apiKey) throw new Error("В .env липсва SPEECHMATICS_API_KEY.");
assertEuRegion("speechmatics", region);
const batchUrl = `https://${region}.asr.api.speechmatics.com/v2`;
// На живо: регионът eu1 отговаря на eu.rt.speechmatics.com (не global, за да остане в ЕС).
const realtimeUrl = `wss://${region.replace(/\d+$/, "")}.rt.speechmatics.com/v2`;
const auth = { Authorization: `Bearer ${apiKey}` };

const wavBytes = readFileSync(audioPath);
const reference = readFileSync(referencePath, "utf8");
const pcm = downsampleToInt16(decodeWav(new Uint8Array(wavBytes)).samples, decodeWav(new Uint8Array(wavBytes)).sampleRate);
const seconds = pcm.length / TARGET_SAMPLE_RATE;
console.log(`Запис ${seconds.toFixed(1)} s, регион ${region}`);

await batch();
await realtime();

async function batch(): Promise<void> {
  const started = performance.now();
  const form = new FormData();
  form.append("config", JSON.stringify({ type: "transcription", transcription_config: { language: "bg" } }));
  form.append("data_file", new Blob([toWav(pcm)], { type: "audio/wav" }), "sample.wav");
  const created = await fetch(`${batchUrl}/jobs`, { method: "POST", headers: auth, body: form });
  if (!created.ok) throw new Error(`Задачата не се създаде: HTTP ${created.status} ${await created.text()}`);
  const { id } = (await created.json()) as { id: string };

  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const status = (await (await fetch(`${batchUrl}/jobs/${id}`, { headers: auth })).json()) as { job: { status: string } };
    if (status.job.status === "done") break;
    if (status.job.status !== "running") throw new Error(`Задачата завърши със състояние ${status.job.status}`);
  }
  const text = (await (await fetch(`${batchUrl}/jobs/${id}/transcript?format=txt`, { headers: auth })).text()).trim();
  const wer = wordErrorRate(reference, text);
  console.log(`\nПартида: ${((performance.now() - started) / 1000).toFixed(1)} s за целия запис, WER ${(wer.wer * 100).toFixed(1)}%`);
  console.log(`  текст: ${text}`);
}

/** Подава звука в реално време на парчета по 100 ms и мери кога идва текстът след края на всяко изречение. */
async function realtime(): Promise<void> {
  // Краищата на изреченията по паузите, както ги реже разширението.
  const segmenter = new UtteranceSegmenter({ sampleRate: TARGET_SAMPLE_RATE });
  const frame = TARGET_SAMPLE_RATE / 10;
  const ends: number[] = [];
  for (let offset = 0; offset < pcm.length; offset += frame) {
    for (const u of segmenter.push(pcm.slice(offset, offset + frame))) ends.push(u.endMs / 1000);
  }
  for (const u of segmenter.flush()) ends.push(u.endMs / 1000);

  const socket = new WebSocket(realtimeUrl, { headers: auth } as unknown as string[]);
  socket.binaryType = "arraybuffer";
  const finals: { text: string; audioEnd: number; receivedAt: number }[] = [];
  let startedAt = 0;
  let sent = 0;

  await new Promise<void>((resolve, reject) => {
    socket.onerror = () => reject(new Error("WebSocket грешка (ключ, регион или мрежа)."));
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          message: "StartRecognition",
          audio_format: { type: "raw", encoding: "pcm_s16le", sample_rate: TARGET_SAMPLE_RATE },
          transcription_config: { language: "bg", max_delay: 1, operating_point: "enhanced" },
        }),
      );
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      const message = JSON.parse(event.data) as {
        message: string;
        reason?: string;
        metadata?: { transcript: string; end_time: number };
      };
      if (message.message === "RecognitionStarted") {
        startedAt = performance.now();
        void (async () => {
          for (let offset = 0; offset < pcm.length; offset += frame) {
            socket.send(pcm.slice(offset, offset + frame).buffer);
            sent++;
            // Реално време: парчето се праща, когато би било записано.
            const due = startedAt + (offset + frame) / (TARGET_SAMPLE_RATE / 1000);
            await new Promise((r) => setTimeout(r, Math.max(0, due - performance.now())));
          }
          socket.send(JSON.stringify({ message: "EndOfStream", last_seq_no: sent }));
        })();
      } else if (message.message === "AddTranscript" && message.metadata?.transcript.trim()) {
        finals.push({ text: message.metadata.transcript, audioEnd: message.metadata.end_time, receivedAt: performance.now() });
      } else if (message.message === "EndOfTranscript") {
        socket.close();
        resolve();
      } else if (message.message === "Error") {
        reject(new Error(`Speechmatics: ${message.reason ?? event.data}`));
      }
    };
  });

  const text = finals
    .map((f) => f.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/ ([,.!?])/g, "$1")
    .trim();
  const wer = wordErrorRate(reference, text);
  console.log(`\nНа живо: WER ${(wer.wer * 100).toFixed(1)}%`);
  // Закъснение: от момента, в който краят на изречението е изпратен, до последния текст за него.
  for (const end of ends) {
    const last = finals.filter((f) => f.audioEnd <= end + 0.3).at(-1);
    if (!last) continue;
    const latency = (last.receivedAt - (startedAt + end * 1000)) / 1000;
    console.log(`  изречение до ${end.toFixed(1)} s: текстът дойде след ${latency.toFixed(1)} s`);
  }
  console.log(`  текст: ${text}`);
}

function toWav(samples: Int16Array): Uint8Array<ArrayBuffer> {
  const header = new DataView(new ArrayBuffer(44));
  const write = (offset: number, text: string) => [...text].forEach((c, i) => header.setUint8(offset + i, c.charCodeAt(0)));
  write(0, "RIFF");
  header.setUint32(4, 36 + samples.byteLength, true);
  write(8, "WAVEfmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, TARGET_SAMPLE_RATE, true);
  header.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  write(36, "data");
  header.setUint32(40, samples.byteLength, true);
  const out = new Uint8Array(44 + samples.byteLength);
  out.set(new Uint8Array(header.buffer), 0);
  out.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), 44);
  return out;
}

function readEnv(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
  return values;
}
