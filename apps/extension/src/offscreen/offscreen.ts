import {
  downsampleToInt16,
  rmsLevel,
  TARGET_SAMPLE_RATE,
  type AudioChunk,
  type AudioSourceKind,
} from "@zara-twin/core";
import {
  isOffscreenMessage,
  type BackgroundMessage,
  type CaptureErrorCode,
  type OffscreenResponse,
} from "../shared/messages";
import type { SttChoice } from "../stt/choices";
import { WorkerTranscription } from "./workerTranscription";

// Offscreen документ: невидима страница на разширението, единственото място в MV3,
// където може да се ползва getUserMedia за звука на таба. Service worker-ът я създава
// при старт и я затваря при стоп.

interface CaptureSession {
  context: AudioContext;
  streams: MediaStream[];
  transcription: WorkerTranscription;
}

let session: CaptureSession | null = null;

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isOffscreenMessage(message)) return;
  const done = (response: OffscreenResponse) => sendResponse(response);
  if (message.type === "offscreen-start") {
    start(message.streamId, message.stt, message.withVideo === true).then(
      () => done({ ok: true }),
      (error: unknown) => done({ ok: false, error: describe(error) }),
    );
  } else {
    stop().then(() => done({ ok: true }));
  }
  return true; // отговорът е асинхронен
});

async function start(streamId: string, stt: SttChoice, withVideo: boolean): Promise<void> {
  await stop();
  const context = new AudioContext();
  const streams: MediaStream[] = [];
  const transcription = new WorkerTranscription({
    onText: (speaker, text, latencyMs) => send({ type: "offscreen-transcript", speaker, text, latencyMs }),
    onStatus: (tone, text) => send({ type: "offscreen-status", tone, text }),
  });
  session = { context, streams, transcription };
  const sources: AudioSourceKind[] = ["tab"];

  try {
    await context.audioWorklet.addModule("pcm-worklet.js");

    // 1. Звукът на срещата (събеседникът). Без него няма смисъл да продължаваме.
    const tab = { chromeMediaSource: "tab", chromeMediaSourceId: streamId };
    const tabStream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: tab },
      // Резервен вариант: някои версии на Chrome не стартират прихващане само на звук.
      // Картината не се използва, затова е в минимално качество, за да не товари компютъра.
      ...(withVideo && { video: { mandatory: { ...tab, maxWidth: 320, maxHeight: 180, maxFrameRate: 1 } } }),
    } as unknown as MediaStreamConstraints);
    streams.push(tabStream);
    const tabSource = context.createMediaStreamSource(tabStream);
    // Прихващането заглушава таба. Пускаме звука обратно, иначе собственикът спира да чува събеседника.
    tabSource.connect(context.destination);
    collect(context, tabSource, "tab");
  } catch (error) {
    await stop();
    throw error;
  }

  // 2. Микрофонът (собственикът). Ако липсва, продължаваме само със събеседника.
  try {
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    streams.push(micStream);
    // Микрофонът не се пуска към високоговорителите, за да няма ехо.
    collect(context, context.createMediaStreamSource(micStream), "microphone");
    sources.push("microphone");
  } catch (error) {
    const code: CaptureErrorCode =
      error instanceof DOMException && error.name === "NotAllowedError"
        ? "mic-permission-denied"
        : "mic-unavailable";
    send({ type: "offscreen-error", code, detail: describe(error) });
  }

  // 3. Разпознаване на говор. Не чакаме зареждането на модела: звукът и нивата вече работят.
  transcription.start(stt, sources);
}

async function stop(): Promise<void> {
  if (session === null) return;
  const { context, streams, transcription } = session;
  session = null;
  transcription.stop();
  for (const stream of streams) for (const track of stream.getTracks()) track.stop();
  await context.close();
}

function collect(context: AudioContext, source: MediaStreamAudioSourceNode, kind: AudioSourceKind): void {
  // Без изходи: възелът само чете звука, нищо не се добавя към високоговорителите.
  const node = new AudioWorkletNode(context, "pcm-collector", { numberOfOutputs: 0 });
  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    handleChunk({
      source: kind,
      pcm: downsampleToInt16(event.data, context.sampleRate),
      sampleRate: TARGET_SAMPLE_RATE,
      capturedAt: Date.now(),
    });
  };
  source.connect(node);
}

function handleChunk(chunk: AudioChunk): void {
  send({ type: "offscreen-level", source: chunk.source, level: rmsLevel(chunk.pcm) });
  session?.transcription.write(chunk);
}

function send(message: BackgroundMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // Service worker-ът може да е спрян за момент. Индикаторът не е критичен.
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
