import { Transcription } from "./transcription";
import type { FromWorker, ToWorker } from "./workerProtocol";

// Worker с разпознаването на говор. Моделът блокира нишката си за секунди;
// тук това не пречи: звукът, нивата и измерването кой колко говори остават
// в главната нишка на offscreen документа и не изостават.

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker): void;
  close(): void;
};

let transcription: Transcription | null = null;

scope.onmessage = (event) => {
  const message = event.data;
  switch (message.type) {
    case "start":
      transcription = new Transcription({
        onText: (speaker, text, latencyMs) => scope.postMessage({ type: "text", speaker, text, latencyMs }),
        onStatus: (tone, text) => scope.postMessage({ type: "status", tone, text }),
      });
      void transcription.start(message.choice, message.sources);
      break;
    case "chunk":
      transcription?.write(message.chunk);
      break;
    case "stop":
      transcription?.stop();
      transcription = null;
      scope.close();
      break;
  }
};
