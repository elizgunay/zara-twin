import { describe, expect, it } from "vitest";
import { CloudTranscription, type CloudDeps } from "./cloudTranscription";

// Подменен сървър: всяка нова връзка отговаря с RecognitionStarted, а тестът
// може да я „прекъсне“ или да прати текст, без интернет и без ключ.
class FakeSocket {
  static all: FakeSocket[] = [];
  static failNext = 0;
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
    queueMicrotask(() => {
      if (FakeSocket.failNext > 0) {
        FakeSocket.failNext--;
        this.onerror?.();
        return;
      }
      this.readyState = 1;
      this.onopen?.();
      this.receive({ message: "RecognitionStarted" });
    });
  }

  send(data: unknown) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: "" });
  }

  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** Прекъсване отвън (интернет, сървър), не от нас. */
  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: "" });
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  FakeSocket.all = [];
  FakeSocket.failNext = 0;
  const statuses: string[] = [];
  const texts: string[] = [];
  const deps: CloudDeps = {
    WebSocket: FakeSocket as unknown as CloudDeps["WebSocket"],
    fetch: (async () => new Response(JSON.stringify({ key_value: "temp" }), { status: 200 })) as typeof fetch,
    sleep: async () => {},
  };
  const cloud = new CloudTranscription(
    { onText: (_speaker, text) => texts.push(text), onStatus: (_tone, text) => statuses.push(text) },
    { provider: "speechmatics", apiKey: "x".repeat(32) },
    deps,
  );
  return { cloud, statuses, texts };
}

const chunk = () => ({ source: "microphone" as const, pcm: new Int16Array(1600), sampleRate: 16_000, capturedAt: Date.now() });

describe("CloudTranscription", () => {
  it("свързва се отново след прекъсване и продължава да праща звук", async () => {
    const { cloud, statuses } = setup();
    cloud.start(["microphone"]);
    await tick();
    await tick();
    FakeSocket.all[0]!.drop();
    await tick();
    await tick();
    await tick();
    expect(FakeSocket.all).toHaveLength(2);
    expect(statuses).toContain("Разпознаването на говор продължава (облак, ЕС).");
    cloud.write(chunk());
    expect(FakeSocket.all[1]!.sent.some((data) => data instanceof ArrayBuffer)).toBe(true);
  });

  it("не се свързва отново след стоп", async () => {
    const { cloud } = setup();
    cloud.start(["microphone"]);
    await tick();
    await tick();
    cloud.stop();
    await tick();
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("спира с ясно съобщение, ако връзката не се възстанови", async () => {
    const { cloud, statuses } = setup();
    cloud.start(["microphone"]);
    await tick();
    await tick();
    FakeSocket.failNext = 100;
    FakeSocket.all[0]!.drop();
    for (let i = 0; i < 30; i++) await tick();
    expect(statuses.at(-1)).toMatch(/спря: няма връзка/);
  });

  it("събира парчетата текст в изречение", async () => {
    const { cloud, texts } = setup();
    cloud.start(["microphone"]);
    await tick();
    await tick();
    const socket = FakeSocket.all[0]!;
    for (const piece of ["Колко", "струва", "T8", "?"]) {
      socket.receive({ message: "AddTranscript", metadata: { transcript: piece, end_time: 1 } });
    }
    expect(texts).toEqual(["Колко струва T8?"]);
  });
});
