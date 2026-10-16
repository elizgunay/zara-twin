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
  type MicProblem,
  type OffscreenResponse,
} from "../shared/messages";
import { log, logLines, throttledCounter } from "../shared/log";
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
const chunkLog = throttledCounter("offscreen парчета звук към worker-а");

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isOffscreenMessage(message)) return;
  const done = (response: OffscreenResponse) => sendResponse(response);
  if (message.type === "offscreen-logs") {
    done({ ok: true, logs: logLines() });
    return;
  }
  if (message.type === "offscreen-start") {
    start(message.streamId, message.stt, message.withVideo === true).then(
      (mic) => done({ ok: true, ...(mic && { mic }) }),
      (error: unknown) => done({ ok: false, error: describe(error) }),
    );
  } else {
    stop().then(() => done({ ok: true }));
  }
  return true; // отговорът е асинхронен
});

/** Връща проблема с микрофона, ако има такъв; звукът на срещата пак работи. */
async function start(streamId: string, stt: SttChoice, withVideo: boolean): Promise<MicProblem | null> {
  await stop();
  log("offscreen", "старт", { stt, withVideo });
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
    log("offscreen", "звукът на таба е прихванат", tabStream.getAudioTracks()[0]?.getSettings(), "AudioContext", context.sampleRate, "Hz");
    const tabSource = context.createMediaStreamSource(tabStream);
    // Прихващането заглушава таба. Пускаме звука обратно, иначе собственикът спира да чува събеседника.
    tabSource.connect(context.destination);
    collect(context, tabSource, "tab");
  } catch (error) {
    await stop();
    throw error;
  }

  // 2. Микрофонът (собственикът). Ако липсва, продължаваме само със събеседника.
  let mic: MicProblem | null = null;
  try {
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    streams.push(micStream);
    log("offscreen", "микрофонът е включен", micStream.getAudioTracks()[0]?.label, micStream.getAudioTracks()[0]?.getSettings());
    // Микрофонът не се пуска към високоговорителите, за да няма ехо.
    collect(context, context.createMediaStreamSource(micStream), "microphone");
    sources.push("microphone");
  } catch (error) {
    const code: CaptureErrorCode =
      error instanceof DOMException && error.name === "NotAllowedError"
        ? "mic-permission-denied"
        : "mic-unavailable";
    mic = { code, detail: describe(error) };
    log("offscreen", "микрофонът не тръгна", mic);
  }

  // 3. Разпознаване на говор. Не чакаме зареждането на модела: звукът и нивата вече работят.
  transcription.start(stt, sources);
  log("offscreen", "разпознаването стартира за", sources);
  return mic;
}

async function stop(): Promise<void> {
  if (session === null) return;
  log("offscreen", "стоп");
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
  chunkLog(chunk.source, () => ({ samples: chunk.pcm.length, level: rmsLevel(chunk.pcm).toFixed(4) }));
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
