/**
 * Логове за диагностика в пилота. Пишат се в конзолата и в кратък буфер в паметта,
 * откъдето бутонът „Логове“ в панела ги събира от всички части на разширението.
 * Не се пише съдържание от разговора, освен кратко начало на разпознатия текст.
 */
const MAX_LINES = 400;
const lines: string[] = [];
let sink: ((line: string) => void) | null = null;

export function log(scope: string, ...details: unknown[]): void {
  const time = new Date().toISOString().slice(11, 23);
  console.info(`[Zara ${time}] ${scope}:`, ...details);
  appendLogLine(`${time} ${scope}: ${details.map(format).join(" ")}`);
}

/** Добавя готов ред (напр. дошъл от worker-а) към буфера на тази част. */
export function appendLogLine(line: string): void {
  if (sink) {
    sink(line);
    return;
  }
  lines.push(line);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

/** Worker-ът няма кой да го попита за логовете: препраща всеки ред към offscreen документа. */
export function forwardLogs(target: (line: string) => void): void {
  sink = target;
}

export function logLines(): string[] {
  return [...lines];
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

function format(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
