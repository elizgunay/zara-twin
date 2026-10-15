import { describe, expect, it } from "vitest";
import type { Hint } from "./engine";
import { TalkRatioTracker } from "./talkRatio";

const LOUD = 0.1;
const QUIET = 0.001;

/** Подава N секунди звук: кой говори (owner / counterpart / both / echo / silence). */
function play(tracker: TalkRatioTracker, clock: { t: number }, who: string, seconds: number): Hint[] {
  const hints: Hint[] = [];
  for (let i = 0; i < seconds * 10; i++) {
    const tab = who === "counterpart" || who === "both" || who === "echo" ? LOUD : QUIET;
    const mic = who === "owner" || who === "both" ? LOUD : who === "echo" ? LOUD * 0.3 : QUIET;
    hints.push(...tracker.onLevel("tab", tab, clock.t), ...tracker.onLevel("microphone", mic, clock.t));
    clock.t += 100;
  }
  return hints;
}

describe("TalkRatioTracker", () => {
  it("смята времето на всеки говорещ", () => {
    const tracker = new TalkRatioTracker();
    const clock = { t: 0 };
    play(tracker, clock, "owner", 30);
    play(tracker, clock, "counterpart", 10);
    play(tracker, clock, "silence", 5);
    expect(tracker.session()).toEqual({ ownerMs: 30_000, counterpartMs: 10_000, ownerShare: 0.75 });
  });

  it("не брои ехото от високоговорителите като говор на ръководителя", () => {
    const tracker = new TalkRatioTracker();
    const clock = { t: 0 };
    play(tracker, clock, "echo", 10);
    expect(tracker.session()).toMatchObject({ ownerMs: 0, counterpartMs: 10_000 });
  });

  it("брои и двамата, когато говорят едновременно", () => {
    const tracker = new TalkRatioTracker();
    play(tracker, { t: 0 }, "both", 5);
    expect(tracker.session()).toMatchObject({ ownerMs: 5_000, counterpartMs: 5_000 });
  });

  it("напомня, когато ръководителят говори над 65% в последните 3 минути", () => {
    const tracker = new TalkRatioTracker();
    const clock = { t: 0 };
    const keys = [
      ...play(tracker, clock, "counterpart", 20),
      ...play(tracker, clock, "owner", 50),
      ...play(tracker, clock, "counterpart", 5),
      ...play(tracker, clock, "owner", 50),
    ].map((h) => h.key);
    expect(keys).toContain("talk:ratio");
  });

  it("не напомня при балансиран разговор", () => {
    const tracker = new TalkRatioTracker();
    const clock = { t: 0 };
    const hints: Hint[] = [];
    for (let i = 0; i < 6; i++) {
      hints.push(...play(tracker, clock, "owner", 20), ...play(tracker, clock, "counterpart", 25));
    }
    expect(hints).toEqual([]);
  });

  it("засича монолог над 60 s, кратките паузи не го прекъсват", () => {
    const tracker = new TalkRatioTracker();
    const clock = { t: 0 };
    const hints = [...play(tracker, clock, "owner", 35), ...play(tracker, clock, "silence", 1), ...play(tracker, clock, "owner", 30)];
    const monologue = hints.find((h) => h.key === "talk:monologue");
    expect(monologue?.title).toMatch(/^Говорите 6\d s без пауза$/);
  });

  it("включването на клиента прекъсва монолога", () => {
    const tracker = new TalkRatioTracker();
    const clock = { t: 0 };
    const hints = [
      ...play(tracker, clock, "owner", 40),
      ...play(tracker, clock, "counterpart", 2),
      ...play(tracker, clock, "owner", 40),
    ];
    expect(hints.some((h) => h.key === "talk:monologue")).toBe(false);
  });

  it("взима правилата от метода", () => {
    const tracker = new TalkRatioTracker({ rules: { monologueSeconds: 20 } });
    const hints = play(tracker, { t: 0 }, "owner", 25);
    expect(hints.map((h) => h.key)).toContain("talk:monologue");
  });
});
