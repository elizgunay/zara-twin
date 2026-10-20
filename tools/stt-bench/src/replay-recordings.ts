// Пуска текста на реален запис през целия Copilot, както по време на среща: фрази, отговори,
// „Сложете ден и час“, модели роботи и разпознаване по смисъл. Резултатът е само локално.
// Употреба: npm.cmd run bench:replay -- --file data/recordings/запис.txt --seller S2 [--until 11:20] [--meaning small|large|off]
// Изход: <запис>.copilot.txt до текста (в data/, не влиза в git).
import { env, pipeline } from "@huggingface/transformers";
import { validateMethodPack, validatePack } from "@zara-twin/knowledge";
import {
  AnswerDetector,
  HintEngine,
  MEANING_MODELS,
  meaningHints,
  MeaningIndex,
  meaningIntents,
  NudgeDetector,
  ObjectionDetector,
  type Hint,
  type MeaningModelId,
} from "@zara-twin/hints";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..", "..");
env.cacheDir = join(root, "data", "models");
const pack = validatePack(JSON.parse(readFileSync(join(root, "knowledge-packs/zara-robotics/pack.json"), "utf8")));
const method = validateMethodPack(JSON.parse(readFileSync(join(root, "knowledge-packs/methods/b2b-sales-bg/method.json"), "utf8")));

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const file = arg("file");
const seller = arg("seller");
if (!file || !seller) throw new Error("Нужни са --file <запис.txt> и --seller S1|S2 (кой е продавачът).");
const until = arg("until");
const meaningChoice = (arg("meaning") ?? "large") as MeaningModelId | "off";

const seconds = (stamp: string) => stamp.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
const limit = until ? seconds(until) : Infinity;

// Редовете са „[мм:сс] S1: текст“ (tools/stt-bench/src/transcribe-recordings.ts).
const lines = readFileSync(file, "utf8")
  .split(/\r?\n/)
  .map((line) => /^\[(\d+:\d{2})\] (S\d+): (.*)$/.exec(line))
  .filter((m): m is RegExpExecArray => m !== null)
  .map((m) => ({ at: seconds(m[1]!), stamp: m[1]!, speaker: m[2] === seller ? ("owner" as const) : ("counterpart" as const), text: m[3]! }))
  .filter((line) => line.at < limit);

let now = 0;
const clock = { now: () => now };
const objections = new ObjectionDetector(method, pack, clock);
const answers = new AnswerDetector(pack, clock);
const nudges = new NudgeDetector(method, clock);
const products = new HintEngine(pack, clock);

let index: MeaningIndex | null = null;
if (meaningChoice !== "off") {
  const model = MEANING_MODELS[meaningChoice];
  const extract = await pipeline("feature-extraction", model.id, { dtype: "q8" });
  const embed = async (texts: string[]) =>
    (await extract(texts.map((t) => model.prefix + t), { pooling: "mean", normalize: true })).tolist() as number[][];
  index = await MeaningIndex.build(meaningIntents(pack, method), embed, { minMargin: Number(arg("margin") ?? model.minMargin) });
}

const show = (hint: Hint) => `${hint.byMeaning ? "≈ " : ""}${hint.title}${hint.say?.[0] ? ` → „${hint.say[0]}“` : ""}`;
const out: string[] = [];
let direct = 0;
let byMeaning = 0;
for (const line of lines) {
  now = line.at * 1000;
  const segment = { speaker: line.speaker, text: line.text };
  const found = [...objections.onSegment(segment), ...answers.onSegment(segment)];
  const extra = [...nudges.onSegment(segment), ...products.onSegment(segment)];
  if (found.length === 0 && line.speaker === "counterpart" && index) {
    const match = await index.match(line.text);
    if (match) {
      const hints = meaningHints(match, answers, objections).map((h) => ({ ...h, title: `${h.title} [${match.margin.toFixed(3)}]` }));
      byMeaning += hints.length;
      found.push(...hints);
    }
  } else direct += found.length;
  out.push(`[${line.stamp}] ${line.speaker === "owner" ? "ПРОДАВАЧ" : "КЛИЕНТ  "}: ${line.text}`);
  for (const hint of [...found, ...extra]) out.push(`           ▶ ${show(hint)}`);
}
const target = file.replace(/\.txt$/, ".copilot.txt");
writeFileSync(target, out.join("\n") + "\n");
console.log(`${lines.length} реда, подсказки по фраза ${direct}, по смисъл ${byMeaning}. Записано в ${target}`);
