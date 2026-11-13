// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * When the media cache's cap is enforced (media SPEC "Cap"). A put that leaves the cache over its cap, or a start
 * that finds it so, asks for a run; the run starts `delayMs` later (30 s in the app), so a burst of puts (an import)
 * makes one run. Never two runs at once: a put over the cap during a run asks for one more after it.
 */

export interface CapTriggerOptions {
  /** One run: in the jobs process, `media.enforceCacheCap` enqueued and waited for. */
  readonly run: () => Promise<void>;
  readonly delayMs: number;
  readonly log: (message: string) => void;
}

export interface CapTrigger {
  /** The cache is over its cap: one run follows, however many times this is called before it starts. */
  overCap(): void;
  /** No more runs (a run already started finishes). */
  stop(): void;
}

export function createCapTrigger(options: CapTriggerOptions): CapTrigger {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;
  let stopped = false;

  function settle(): void {
    running = false;
    if (!again) return;
    again = false;
    overCap();
  }

  function fire(): void {
    timer = undefined;
    running = true;
    void options.run().then(settle, (cause: unknown) => {
      options.log(
        `the cache's cap wasn't enforced: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      settle();
    });
  }

  function overCap(): void {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    if (timer) return;
    timer = setTimeout(fire, options.delayMs);
    timer.unref();
  }

  return {
    overCap,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
