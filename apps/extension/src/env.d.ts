// Стойности, които esbuild вгражда при изграждане (виж build.mjs).
/** OAuth Client ID от Google Cloud. Не е тайна. Празен низ = календарът не е настроен. */
declare const __GOOGLE_CLIENT_ID__: string;
/** Таблото: адресът на проекта в Supabase и публичният Publishable key (от .env при изграждане). */
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_KEY__: string;
