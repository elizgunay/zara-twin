import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

// Ключовете се четат от .env в корена на проекта. Само публичните: SUPABASE_URL и
// SUPABASE_PUBLISHABLE_KEY. Secret key никога не влиза в таблото (заобикаля правилата).
const root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "SUPABASE_");
  if (env.SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_secret_")) {
    throw new Error("В .env е сложен Secret key. Таблото приема само Publishable key (sb_publishable_…).");
  }
  return {
    define: {
      __SUPABASE_URL__: JSON.stringify(env.SUPABASE_URL ?? ""),
      __SUPABASE_KEY__: JSON.stringify(env.SUPABASE_PUBLISHABLE_KEY ?? ""),
    },
    server: { port: 5180, strictPort: true },
    preview: { port: 5180, strictPort: true },
  };
});
