// Изгражда разширението в dist/, готово за „Load unpacked“ в Chrome/Edge.
// Употреба: npm run build -w @zara-twin/extension  (или --watch за автоматично преизграждане)
import { build, context } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const outdir = join(root, "dist");
const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: {
    background: join(root, "src/background.ts"),
    content: join(root, "src/content.ts"),
  },
  outdir,
  bundle: true,
  // Content script-овете не поддържат ES модули, затова всеки файл е самостоятелен IIFE.
  format: "iife",
  target: "chrome116",
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
};

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await copyFile(join(root, "manifest.json"), join(outdir, "manifest.json"));

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
