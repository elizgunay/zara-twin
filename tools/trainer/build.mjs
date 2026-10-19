// Сглобява страницата за тренировка: шаблон + данни от пакета знания и метода.
// Така клиентът в тренировката знае само истинските данни, а оценката следва репликите на Copilot.
// Пускане: node tools/trainer/build.mjs → tools/trainer/dist/zara-trainer.html
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const pack = JSON.parse(readFileSync(join(root, "knowledge-packs/zara-robotics/pack.json"), "utf8"));
const method = JSON.parse(readFileSync(join(root, "knowledge-packs/methods/b2b-sales-bg/method.json"), "utf8"));

// Само по 8 характеристики на модел: достатъчно за реалистичен клиент, без да раздуваме заявката.
const products = pack.products.map((p) => {
  const specs = Object.entries(Object.assign({}, ...Object.values(p.specs ?? {}))).slice(0, 8);
  return { code: p.code, name: p.name, category: p.category, summary: p.summary, specs: Object.fromEntries(specs) };
});

const data = {
  business: { name: pack.business.name, description: pack.business.description },
  products,
  policies: pack.policies.map((p) => ({ topic: p.topic, text: p.text })),
  faq: pack.faq.map((f) => ({ q: f.question, a: f.answer })),
  objections: method.objections.map((o) => ({ id: o.id, label: o.label, examples: o.triggers.slice(0, 6), say: o.say, escalate: o.escalate ?? [] })),
};

// „<“ се екранира, за да не може текст от данните да затвори <script>.
const json = JSON.stringify(data).replace(/</g, "\\u003c");
const template = readFileSync(join(here, "trainer.template.html"), "utf8");
if (!template.includes("/*__DATA__*/null")) throw new Error("Шаблонът няма място за данните.");
mkdirSync(join(here, "dist"), { recursive: true });
const out = join(here, "dist", "zara-trainer.html");
writeFileSync(out, template.replace("/*__DATA__*/null", json));
console.log(`Готово: ${out} (${Math.round(json.length / 1024)} KB данни)`);
