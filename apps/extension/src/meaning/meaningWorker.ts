import { pipeline } from "@huggingface/transformers";
import { MEANING_MODELS, MeaningIndex, meaningIntents, type Embed, type MeaningModelId } from "@zara-twin/hints";
import { method, pack } from "../pack";
import { forwardLogs, log } from "../shared/log";
import { configureRuntime } from "../stt/runtime";
import type { FromMeaningWorker, ToMeaningWorker } from "./protocol";
import { cachedEmbed } from "./vectorCache";

// Worker с модела за смисъл: изчисленията блокират нишката си, а звукът и разпознаването
// на говор в offscreen документа не изостават. Всичко е на компютъра: моделът се сваля
// веднъж от Hugging Face (само файлове), изреченията от разговора не излизат никъде.

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ToMeaningWorker>) => void) | null;
  postMessage(message: FromMeaningWorker): void;
};

forwardLogs((line) => scope.postMessage({ type: "log", line }));
configureRuntime();

type Extractor = (texts: string[], options: { pooling: "mean"; normalize: true }) => Promise<{ tolist(): number[][] }>;

let index: Promise<MeaningIndex> | null = null;

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "load") {
    if (index) return;
    index = load(message.model);
    index.catch((error: unknown) => {
      log("meaning", "не се зареди", error);
      scope.postMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    });
    return;
  }
  // Докато моделът се зарежда, отговорът е „няма“: подсказките по фрази работят и без него.
  const ready = index ?? Promise.reject(new Error("не е зареден"));
  void ready
    .then((loaded) => loaded.match(message.text))
    .catch(() => null)
    .then((match) => scope.postMessage({ type: "match", id: message.id, match }));
};

async function load(choice: MeaningModelId): Promise<MeaningIndex> {
  const model = MEANING_MODELS[choice];
  const started = Date.now();
  let lastPercent = -10;
  const extract = (await pipeline("feature-extraction", model.id, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (event: { status: string; file?: string; progress?: number }) => {
      // Само големият файл на модела и само през 10%: иначе са стотици съобщения.
      if (event.status !== "progress" || !event.file?.endsWith(".onnx")) return;
      const percent = Math.floor(event.progress ?? 0);
      if (percent - lastPercent < 10) return;
      lastPercent = percent;
      scope.postMessage({ type: "progress", percent });
    },
  } as Parameters<typeof pipeline>[2])) as unknown as Extractor;
  log("meaning", "моделът е зареден", model.id, Date.now() - started, "ms");

  const embed: Embed = async (texts) =>
    (await extract(texts.map((text) => model.prefix + text), { pooling: "mean", normalize: true })).tolist();
  const intents = meaningIntents(pack, method);
  const total = intents.reduce((sum, intent) => sum + intent.texts.length, 0);
  let done = 0;
  const buildEmbed = await cachedEmbed(model.id, embed, (count) => {
    done += count;
    scope.postMessage({ type: "indexing", done, total });
  });
  const ready = await MeaningIndex.build(intents, embed, { buildEmbed, minMargin: model.minMargin });
  const ms = Date.now() - started;
  log("meaning", "готово", ready.size, "изречения", ms, "ms");
  scope.postMessage({ type: "ready", sentences: ready.size, ms });
  return ready;
}
