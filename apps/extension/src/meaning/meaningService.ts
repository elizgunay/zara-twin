import type { MeaningMatch, MeaningModelId } from "@zara-twin/hints";
import { appendLogLine, log } from "../shared/log";
import type { FromMeaningWorker, ToMeaningWorker } from "./protocol";

export interface MeaningEvents {
  onProgress?(percent: number): void;
  onIndexing?(done: number, total: number): void;
  onReady?(sentences: number, ms: number): void;
  onError?(text: string): void;
}

/** Отговорът по смисъл е полезен само веднага: по-късно разговорът вече е продължил. */
const MATCH_TIMEOUT_MS = 4_000;

/** Моделът за смисъл в отделна нишка: в offscreen документа по време на среща и в настройките. */
export class MeaningService {
  private readonly worker = new Worker(new URL("meaning-worker.js", location.href), { type: "module" });
  private readonly pending = new Map<number, (match: MeaningMatch | null) => void>();
  private nextId = 1;

  constructor(model: MeaningModelId, events: MeaningEvents = {}) {
    this.worker.onmessage = (event: MessageEvent<FromMeaningWorker>) => {
      const message = event.data;
      switch (message.type) {
        case "log":
          appendLogLine(`[смисъл] ${message.line}`);
          break;
        case "progress":
          events.onProgress?.(message.percent);
          break;
        case "indexing":
          events.onIndexing?.(message.done, message.total);
          break;
        case "ready":
          events.onReady?.(message.sentences, message.ms);
          break;
        case "error":
          events.onError?.(message.text);
          break;
        case "match":
          this.pending.get(message.id)?.(message.match);
          this.pending.delete(message.id);
          break;
      }
    };
    this.worker.onerror = (event) => {
      log("meaning", "грешка", event.message);
      events.onError?.(event.message || "неизвестна грешка");
    };
    this.post({ type: "load", model });
  }

  match(text: string): Promise<MeaningMatch | null> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.post({ type: "match", id, text });
      setTimeout(() => {
        if (this.pending.delete(id)) resolve(null);
      }, MATCH_TIMEOUT_MS);
    });
  }

  stop(): void {
    this.worker.terminate();
    for (const resolve of this.pending.values()) resolve(null);
    this.pending.clear();
  }

  private post(message: ToMeaningWorker): void {
    this.worker.postMessage(message);
  }
}
