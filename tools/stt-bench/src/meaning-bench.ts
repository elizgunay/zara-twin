// Мери разпознаването по смисъл с истинския локален модел (в Node, както в браузъра).
// Употреба: npm.cmd run bench:meaning -- --model small|large
// Изреченията тук са измислени перифрази (не са от записите): всяко НЕ съвпада с фразите в пакета,
// затова без разпознаване по смисъл подсказка няма. Неутралните не трябва да дават подсказка.
import { env, pipeline } from "@huggingface/transformers";
import { validateMethodPack, validatePack } from "@zara-twin/knowledge";
import { MEANING_MODELS, MeaningIndex, meaningIntents, type MeaningModelId } from "@zara-twin/hints";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..", "..");
env.cacheDir = join(root, "data", "models");
const pack = validatePack(JSON.parse(readFileSync(join(root, "knowledge-packs/zara-robotics/pack.json"), "utf8")));
const method = validateMethodPack(JSON.parse(readFileSync(join(root, "knowledge-packs/methods/b2b-sales-bg/method.json"), "utf8")));

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const choice = (arg("model") ?? "large") as MeaningModelId;
const model = MEANING_MODELS[choice];
if (!model) throw new Error("--model трябва да е small или large");
const minMargin = Number(arg("margin") ?? model.minMargin);

const cases: [string, string][] = [
  ["Колко ще ми излезе цялата работа?", "price"],
  ["Каква сума трябва да предвидим?", "price"],
  ["Ами ако се счупи, кой ще дойде?", "service"],
  ["Имате ли хора, които го оправят, ако нещо стане?", "service"],
  ["Колко време го покривате, ако има дефект?", "warranty"],
  ["Може ли да го вземем за месец-два, преди да го купим?", "rent"],
  ["Може ли да плащаме на части всеки месец?", "rent"],
  ["Мога ли да дойда да го пипна и да видя как се движи?", "demo"],
  ["Ще ни дадете ли документ за счетоводството?", "invoice"],
  ["Персоналът ни е възрастен, дали ще се оправят с него?", "training"],
  ["За колко дни може да го пуснете при нас?", "rollout"],
  ["Ще се качва ли сам на втория етаж?", "elevator"],
  ["Няма ли да събори някое дете?", "safety"],
  ["Ще се върже ли с програмата, през която маркираме поръчките?", "integration"],
  ["Кога физически ще го имаме в ресторанта?", "delivery"],
  ["След пет години ще работи ли още?", "lifespan"],
  ["Може ли да казва нашето меню и името на заведението?", "customize"],
  ["Нека го обсъдя вкъщи и ще ви кажа.", "obj:think"],
  ["Дайте ни малко време да прецените.", "obj:think"],
  ["Сега сме в ремонт, по-късно може би.", "obj:timing"],
  ["Честно казано, сумата ме стряска.", "obj:price"],
  ["За нас това е прекалено.", "obj:price"],
  ["Партньорът ми трябва да каже последната дума.", "obj:authority"],
  ["Хората ни няма да го приемат, гостите са по-възрастни.", "obj:trust"],
  ["Видях подобни на половин цена в интернет.", "obj:competitor"],
];
const neutral = [
  "Алло, тук ли сте?",
  "Аха, точно така.",
  "Ние сме в Пловдив, в центъра.",
  "Вчера имахме много гости.",
  "Изчакайте секунда, звънят ми на другия телефон.",
  "Хубаво време днес.",
  "Окей, продължете.",
  "Колегата ми е в отпуск тази седмица.",
  "Мерси, лека вечер.",
  "Не, не е скъпо, просто питам.",
];

const extract = await pipeline("feature-extraction", model.id, { dtype: "q8" });
const embed = async (texts: string[]) =>
  (await extract(texts.map((t) => model.prefix + t), { pooling: "mean", normalize: true })).tolist() as number[][];

const started = Date.now();
const index = await MeaningIndex.build(meaningIntents(pack, method), embed, { minMargin });
console.log(`${model.id}, отстъп ≥ ${minMargin}: ${index.size} изречения от пакета за ${Date.now() - started} ms`);

let right = 0;
let wrong = 0;
const times: number[] = [];
for (const [text, want] of [...cases, ...neutral.map((t) => [t, "—"] as [string, string])]) {
  const t0 = Date.now();
  const found = await index.match(text);
  times.push(Date.now() - t0);
  const got = found ? `${found.kind === "objection" ? "obj:" : ""}${found.id}` : "—";
  if (got === want && want !== "—") right++;
  else if (got !== "—") wrong++;
  const mark = got === want ? "✔" : got === "—" ? "·" : "✘";
  console.log(`${mark} ${got.padEnd(12)} (${want}) ${found ? found.margin.toFixed(3) : "     "}  ${text}`);
}
times.sort((a, b) => a - b);
console.log(`\nхванати ${right}/${cases.length}, грешни подсказки ${wrong}, медиана ${times[Math.floor(times.length / 2)]} ms`);
