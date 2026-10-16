import { beforeAll, describe, expect, it } from "vitest";

// Worklet-ът живее в AudioWorkletGlobalScope: тук подменяме глобалните имена.
// postMessage прехвърля буфера като истинския браузър (structuredClone с transfer),
// затова тестът хваща грешката, при която звукът спираше след първите 100 ms.
type Processor = { process(inputs: Float32Array[][]): boolean };
let Collector: new () => Processor;
const received: Float32Array[] = [];

beforeAll(async () => {
  const scope = globalThis as Record<string, unknown>;
  scope.sampleRate = 16_000;
  scope.AudioWorkletProcessor = class {
    readonly port = {
      postMessage: (data: Float32Array, transfer: ArrayBuffer[]) => received.push(structuredClone(data, { transfer })),
    };
  };
  scope.registerProcessor = (_name: string, processor: new () => Processor) => {
    Collector = processor;
  };
  await import("./pcm-worklet");
});

describe("pcm-collector", () => {
  it("праща парче от 100 ms всеки път, не само първия", () => {
    const processor = new Collector();
    const block = new Float32Array(128).fill(0.5);
    // 2 секунди звук на блокове по 128 семпла, както ги подава браузърът.
    for (let i = 0; i < Math.ceil((2 * 16_000) / 128); i++) processor.process([[block]]);
    expect(received.length).toBe(20);
    expect(received.every((chunk) => chunk.length === 1600)).toBe(true);
  });
});
