import { describe, expect, it } from "vitest";
import { BacklogError, serialTranscriber } from "./serial";
import type { Transcriber } from "./whisperProvider";

/** Модел, чиито отговори пускаме ръчно, за да видим реда. */
function manualModel() {
  const calls: { resolve: (text: string) => void; reject: (e: Error) => void }[] = [];
  let active = 0;
  let maxActive = 0;
  const model: Transcriber = {
    id: "manual",
    transcribe: () =>
      new Promise<string>((resolve, reject) => {
        active++;
        maxActive = Math.max(maxActive, active);
        calls.push({
          resolve: (t) => {
            active--;
            resolve(t);
          },
          reject: (e) => {
            active--;
            reject(e);
          },
        });
      }),
  };
  return { model, calls, maxActive: () => maxActive };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("serialTranscriber", () => {
  it("пуска изказванията едно по едно, в реда на подаване", async () => {
    const { model, calls, maxActive } = manualModel();
    const serial = serialTranscriber(model);
    const first = serial.transcribe(new Float32Array(1));
    const second = serial.transcribe(new Float32Array(1));
    await tick();
    expect(calls).toHaveLength(1); // второто чака
    calls[0]!.resolve("едно");
    await tick();
    calls[1]!.resolve("две");
    expect([await first, await second]).toEqual(["едно", "две"]);
    expect(maxActive()).toBe(1);
  });

  it("пропуска нови изказвания, когато опашката е пълна", async () => {
    const { model, calls } = manualModel();
    const serial = serialTranscriber(model, 2);
    const a = serial.transcribe(new Float32Array(1));
    const b = serial.transcribe(new Float32Array(1));
    await expect(serial.transcribe(new Float32Array(1))).rejects.toBeInstanceOf(BacklogError);
    await tick();
    calls[0]!.resolve("a");
    await tick();
    calls[1]!.resolve("b");
    await Promise.all([a, b]);
    // След като опашката се освободи, пак приема.
    const c = serial.transcribe(new Float32Array(1));
    await tick();
    calls[2]!.resolve("c");
    expect(await c).toBe("c");
  });

  it("грешка в едно изказване не спира следващите", async () => {
    const { model, calls } = manualModel();
    const serial = serialTranscriber(model);
    const bad = serial.transcribe(new Float32Array(1));
    const good = serial.transcribe(new Float32Array(1));
    await tick();
    calls[0]!.reject(new Error("GPU"));
    await expect(bad).rejects.toThrow("GPU");
    await tick();
    calls[1]!.resolve("наред");
    expect(await good).toBe("наред");
  });
});
