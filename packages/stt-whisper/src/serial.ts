import type { Transcriber } from "./whisperProvider";

/** Компютърът не смогва: изказването е пропуснато, за да не изостава текстът с минути. */
export class BacklogError extends Error {
  constructor() {
    super("backlog");
    this.name = "BacklogError";
  }
}

/**
 * Един модел, много потоци (ръководителят и клиентът): изказванията се разпознават
 * едно по едно. Ако чакат повече от `maxPending`, новите се пропускат. По-добре
 * да липсва едно изречение, отколкото всички подсказки да закъсняват все повече.
 */
export function serialTranscriber(inner: Transcriber, maxPending = 3): Transcriber {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  return {
    id: inner.id,
    transcribe(audio) {
      if (pending >= maxPending) return Promise.reject(new BacklogError());
      pending++;
      const run = tail.then(() => inner.transcribe(audio)).finally(() => {
        pending--;
      });
      tail = run.catch(() => {});
      return run;
    },
  };
}
