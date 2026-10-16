// Сервира apps/extension/dist локално, без заглавки за изолация (COOP/COEP), както е и в
// разширението (виж manifest.json: с тях Chrome отказва прихващането на таба). Служи за проверка на теста на
// компютъра в обикновен браузър, без да се зарежда разширението.
// Употреба: node tools/serve-extension.mjs [порт]
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve("apps/extension/dist");
const port = Number(process.argv[2] ?? 5178);
// --isolated: със заглавките COOP/COEP (многонишков WebAssembly), за сравнение на скоростта.
const isolated = process.argv.includes("--isolated");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
};

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const file = normalize(join(root, path === "/" ? "selftest.html" : path));
  if (!file.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  try {
    if (!statSync(file).isFile()) throw new Error("not a file");
  } catch {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": types[extname(file)] ?? "application/octet-stream",
    "Cross-Origin-Resource-Policy": "same-origin",
    ...(isolated && { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" }),
  });
  createReadStream(file).pipe(response);
}).listen(port, "127.0.0.1", () => console.log(`http://localhost:${port}/selftest.html`));
