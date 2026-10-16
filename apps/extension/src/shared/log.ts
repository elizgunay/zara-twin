/**
 * Логове за диагностика в пилота. Виждат се в конзолата на съответната част:
 * chrome://extensions → Zara Copilot → „Inspect views“ (offscreen.html или service worker).
 * Логовете от worker-а с разпознаването излизат в конзолата на offscreen.html.
 * Не се пише съдържание от разговора, освен кратко начало на разпознатия текст.
 */
export function log(scope: string, ...details: unknown[]): void {
  const time = new Date().toISOString().slice(11, 23);
  console.info(`[Zara ${time}] ${scope}:`, ...details);
}

/** Брояч, който пише в лога най-много веднъж на intervalMs (за парчетата звук: 10 в секунда). */
export function throttledCounter(scope: string, intervalMs = 5_000) {
  const counts = new Map<string, number>();
  let last = Date.now();
  return (key: string, extra?: () => unknown) => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const now = Date.now();
    if (now - last < intervalMs) return;
    last = now;
    log(scope, Object.fromEntries(counts), ...(extra ? [extra()] : []));
    counts.clear();
  };
}
