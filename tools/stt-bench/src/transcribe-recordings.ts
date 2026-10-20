import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { assertEuRegion } from "@zara-twin/core";
import { sttVocabulary, validatePack } from "@zara-twin/knowledge";
import rawPack from "../../../knowledge-packs/zara-robotics/pack.json" with { type: "json" };

// Текст от реални записи (mp3/m4a/wav/mp4) през Speechmatics в ЕС, както го чува Copilot:
// български, „enhanced“, същият речник (имената на роботите). Разделя говорещите (S1, S2…).
// Записите и текстът остават в data/recordings (извън git). Ключът е от .env и не се печата.
// Употреба: npm.cmd run bench:recordings -- [--dir data/recordings] [--vocab думи.txt] [--suffix след] [--force]
// Вече обработен запис се пропуска (минутите в плана се харчат само веднъж), освен с --force.

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const dir = option("dir", "data/recordings");
const suffix = option("suffix", "");
const extraVocabPath = option("vocab", "");
const force = args.includes("--force");

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => [m[1]!, m[2]!.replace(/^["']|["']$/g, "")]),
);
const apiKey = env.SPEECHMATICS_API_KEY ?? "";
const region = env.SPEECHMATICS_REGION || "eu1";
if (!apiKey) throw new Error("В .env липсва SPEECHMATICS_API_KEY.");
assertEuRegion("speechmatics", region);
const batchUrl = `https://${region}.asr.api.speechmatics.com/v2`;
const auth = { Authorization: `Bearer ${apiKey}` };

/** Същият речник като в разширението (sttVocabulary от пакета) + допълнителни думи от файл. */
function vocabulary(): { content: string; sounds_like?: string[] }[] {
  const items: { content: string; sounds_like?: string[] }[] = sttVocabulary(validatePack(rawPack));
  if (extraVocabPath) {
    // Ред: „дума“ или „дума | как звучи 1 | как звучи 2“.
    for (const line of readFileSync(extraVocabPath, "utf8").split(/\r?\n/)) {
      const [content, ...sounds] = line.split("|").map((s) => s.trim()).filter(Boolean);
      if (content) items.push(sounds.length ? { content, sounds_like: sounds } : { content });
    }
  }
  return items.slice(0, 1000);
}

interface Word {
  type: "word" | "punctuation";
  start_time: number;
  alternatives: { content: string; speaker?: string }[];
  attaches_to?: string;
}

async function transcribe(file: string): Promise<string> {
  const form = new FormData();
  form.append(
    "config",
    JSON.stringify({
      type: "transcription",
      transcription_config: { language: "bg", operating_point: "enhanced", diarization: "speaker", additional_vocab: vocabulary() },
    }),
  );
  form.append("data_file", new Blob([new Uint8Array(readFileSync(file))]), basename(file));
  const created = await fetch(`${batchUrl}/jobs`, { method: "POST", headers: auth, body: form });
  if (!created.ok) throw new Error(`Задачата не се създаде: HTTP ${created.status} ${await created.text()}`);
  const { id } = (await created.json()) as { id: string };
  process.stdout.write(`  задача ${id}: обработва се`);
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const status = (await (await fetch(`${batchUrl}/jobs/${id}`, { headers: auth })).json()) as { job: { status: string } };
    if (status.job.status === "done") break;
    if (status.job.status !== "running") throw new Error(`\nЗадачата завърши със състояние ${status.job.status}`);
    process.stdout.write(".");
  }
  const result = (await (await fetch(`${batchUrl}/jobs/${id}/transcript?format=json-v2`, { headers: auth })).json()) as { results: Word[] };
  return toLines(result.results);
}

/** „[02:15] S1: текст“ — нов ред при смяна на говорещия или пауза над 2 s. */
function toLines(words: Word[]): string {
  const lines: string[] = [];
  let speaker = "";
  let start = 0;
  let last = -Infinity;
  let text = "";
  const stamp = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const flush = () => {
    if (text.trim()) lines.push(`[${stamp(start)}] ${speaker || "S?"}: ${text.trim()}`);
    text = "";
  };
  for (const w of words) {
    const alt = w.alternatives[0];
    if (!alt) continue;
    if (w.type === "punctuation") {
      text += alt.content;
      continue;
    }
    const who = alt.speaker ?? speaker;
    if (who !== speaker || w.start_time - last > 2) {
      flush();
      speaker = who;
      start = w.start_time;
    }
    text += ` ${alt.content}`;
    last = w.start_time;
  }
  flush();
  return lines.join("\n") + "\n";
}

const files = readdirSync(dir).filter((f) => /\.(mp3|m4a|wav|mp4|ogg|webm)$/i.test(f));
if (files.length === 0) throw new Error(`Няма записи в ${dir}.`);
for (const f of files) {
  const out = join(dir, `${basename(f, extname(f))}${suffix ? `.${suffix}` : ""}.txt`);
  if (existsSync(out) && !force) {
    console.log(`${f}: вече има текст (${basename(out)}), пропускам.`);
    continue;
  }
  console.log(`${f}:`);
  const started = Date.now();
  writeFileSync(out, await transcribe(join(dir, f)));
  console.log(`\n  готово за ${Math.round((Date.now() - started) / 1000)} s → ${basename(out)}`);
}
