// Изгражда разширението в dist/, готово за „Load unpacked“ в Chrome/Edge.
// Употреба: npm run build -w @zara-twin/extension  (или --watch за автоматично преизграждане)
// GOOGLE_OAUTH_CLIENT_ID се чете от .env в корена (виж docs/setup/google-calendar.md).
import { build, context } from "esbuild";
import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

// Таблото (Supabase, Франкфурт): само публичният Publishable key. Secret key заобикаля правилата
// за достъп и никога не влиза в разширение, което се дава на други хора.
if (process.env.SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_secret_")) {
  throw new Error("В .env е сложен Secret key. Разширението приема само Publishable key (sb_publishable_…).");
}
const outdir = join(root, "dist");
const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: {
    background: join(root, "src/background.ts"),
    content: join(root, "src/content.ts"),
    "pcm-worklet": join(root, "src/audio/pcm-worklet.ts"),
    permission: join(root, "src/permission/permission.ts"),
    settings: join(root, "src/settings/settings.ts"),
  },
  define: {
    // Client ID не е тайна (вижда се в адреса за вход), но е различен за всяка инсталация.
    __GOOGLE_CLIENT_ID__: JSON.stringify(process.env.GOOGLE_OAUTH_CLIENT_ID ?? ""),
    __SUPABASE_URL__: JSON.stringify(process.env.SUPABASE_URL ?? ""),
    __SUPABASE_KEY__: JSON.stringify(process.env.SUPABASE_PUBLISHABLE_KEY ?? ""),
    // Таблото онлайн (Cloudflare Pages); за друга инсталация: DASHBOARD_URL в .env.
    __DASHBOARD_URL__: JSON.stringify(process.env.DASHBOARD_URL ?? "https://zara-copilot.pages.dev"),
    // Облакът по подразбиране, без въвеждане на ключа. Ключът влиза в dist/ (не е в git):
    // давайте изградената папка само на доверени хора.
    // ZARA_PILOT_PACKAGE=1 (npm run pilot-package): пакетът за други хора е винаги без ключ.
    __SPEECHMATICS_KEY__: JSON.stringify(process.env.ZARA_PILOT_PACKAGE === "1" ? "" : (process.env.SPEECHMATICS_API_KEY ?? "")),
  },
  outdir,
  bundle: true,
  // Content script-овете не поддържат ES модули, затова всеки файл е самостоятелен IIFE.
  format: "iife",
  target: "chrome116",
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
};

// Тестът на компютъра и offscreen документът (разпознаване на говор) ползват transformers.js и ONNX Runtime, които зареждат
// WebAssembly динамично: затова е ES модул, отделно от останалите скриптове.
/** @type {import("esbuild").BuildOptions} */
const selftestOptions = {
  ...options,
  entryPoints: {
    selftest: join(root, "src/selftest/selftest.ts"),
    offscreen: join(root, "src/offscreen/offscreen.ts"),
    "stt-worker": join(root, "src/offscreen/sttWorker.ts"),
    "devtest-pipeline": join(root, "src/devtest/pipeline.ts"),
    "devtest-models": join(root, "src/devtest/models.ts"),
  },
  format: "esm",
  platform: "browser",
  logLevel: "warning",
};

// Двоичните файлове на ONNX Runtime трябва да са в разширението (MV3 забранява код от чужди сървъри).
const ortDist = join(root, "..", "..", "node_modules", "onnxruntime-web", "dist");
// Само вариантът „jsep“ (WebGPU + WASM): проверено в браузъра, че другият не се зарежда.
const ortFiles = ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"];

await rm(outdir, { recursive: true, force: true });
await mkdir(join(outdir, "ort"), { recursive: true });
await copyFile(join(root, "manifest.json"), join(outdir, "manifest.json"));
await cp(join(root, "static"), outdir, { recursive: true });
for (const file of ortFiles) await copyFile(join(ortDist, file), join(outdir, "ort", file));

if (watch) {
  await (await context(selftestOptions)).watch();
  await (await context(options)).watch();
} else {
  await build(selftestOptions);
  await build(options);
}
