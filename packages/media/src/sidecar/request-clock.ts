// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A request's clock (json-line.ts): an overall cap (`timeoutMs`) and, with `stallTimeoutMs`, a wait for the helper's
 * next line about the request, which every progress line starts again (FIX-OCRCOLD). A helper that is alive and
 * working (Apple Vision compiling its models for the Neural Engine took up to 4 minutes on a busy Mac) is waited for
 * up to the cap; one that dies fails at once (the process's exit), and one that goes quiet fails after the stall.
 *
 * A stall is checked once more after this turn's input is read (`setImmediate` runs after the poll phase): when this
 * process's own event loop was blocked longer than the stall, its timer fires before the helper's waiting lines are
 * read, and those lines are the proof the helper never stalled.
 */
export interface RequestClock {
  /** The helper said something about the request: the stall wait starts again. */
  touch(): void;
  /** The request settled: no timer fires after this. */
  clear(): void;
}

export interface RequestClockOptions {
  readonly timeoutMs?: number;
  readonly stallTimeoutMs?: number;
}

export type ClockExpiry = { readonly kind: 'cap' | 'stall'; readonly ms: number };

/**
 * `afterInput` runs a callback once this turn's input has been read: `setImmediate` (a test's fake clock passes a
 * timer of its own).
 */
export function startRequestClock(
  options: RequestClockOptions,
  onExpire: (expiry: ClockExpiry) => void,
  afterInput: (callback: () => void) => unknown = setImmediate,
): RequestClock {
  const { timeoutMs, stallTimeoutMs } = options;
  let done = false;
  let touched = 0;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const expire = (expiry: ClockExpiry) => {
    if (done) return;
    clear();
    onExpire(expiry);
  };
  const cap =
    timeoutMs === undefined ? undefined : setTimeout(() => expire({ kind: 'cap', ms: timeoutMs }), timeoutMs);
  const armStall = () => {
    if (stallTimeoutMs === undefined || done) return;
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      const seen = touched;
      afterInput(() => {
        if (touched === seen) expire({ kind: 'stall', ms: stallTimeoutMs });
      });
    }, stallTimeoutMs);
  };
  function clear(): void {
    done = true;
    if (cap) clearTimeout(cap);
    if (stallTimer) clearTimeout(stallTimer);
  }
  armStall();
  return {
    touch() {
      if (done) return;
      touched++;
      armStall();
    },
    clear,
  };
}
