// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The engine's timers: polls, lease checks and retry wake-ups, all cleared when it stops. */

export class EngineTimers {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  /** @param open Whether the engine still runs; nothing is scheduled or fired once it doesn't. */
  constructor(private readonly open: () => boolean) {}

  later(ms: number, fn: () => void): void {
    if (!this.open()) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }

  every(ms: number, fn: () => void): void {
    const tick = () => {
      fn();
      this.later(ms, tick);
    };
    this.later(ms, tick);
  }

  clear(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}

/** Resolves when every promise has settled or after `ms`, whichever comes first. Never rejects. */
export function settleWithin(promises: readonly Promise<unknown>[], ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)));
  const all = Promise.allSettled(promises).then(() => undefined);
  return Promise.race([all, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Runs `step(id)` (if any) and resolves once it settles or after `ms`, whichever comes first. A failing step is
 * logged, never thrown: it may delay what comes next, never stop it.
 */
export function boundedStep<T>(
  step: ((id: T) => Promise<void>) | undefined,
  id: T,
  ms: number,
  log: (message: string) => void,
): Promise<void> {
  if (!step) return Promise.resolve();
  const done = step(id).catch((cause: unknown) =>
    log(`after-job step for ${String(id)} failed: ${String(cause)}`),
  );
  return settleWithin([done], ms);
}
