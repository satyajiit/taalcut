// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-RUN: a call whose stream delivers nothing for a while is aborted, so it fails as a dropped connection the
 * agent retries instead of hanging for minutes (the owner's run waited 5 minutes for a socket that had died).
 * "Nothing" means no bytes on the wire and no event from pi-ai: a model that thinks quietly still sends bytes.
 * FIX-CMT: with `deadlineMs`, a call that is still going that long after it started is aborted too, however much
 * it streams: an embedded runtime's answer that runs away keeps sending bytes.
 */

/** Default: 90 s without a byte or an event. */
export const DEFAULT_STALL_MS = 90_000;

export interface StallWatch {
  /** The signal the call runs on: the request's, plus the watchdog's abort. */
  readonly signal: AbortSignal;
  /** Something arrived: the quiet time starts again. */
  alive(): void;
  /** The watchdog aborted the call. */
  readonly stalled: boolean;
  /** The call ran past its deadline (FIX-CMT); `stalled` is true too. */
  readonly overDeadline: boolean;
  stop(): void;
}

export function watchStall(options: {
  readonly stallMs: number;
  readonly signal?: AbortSignal;
  /** Bytes received so far (the HTTP meter's count): growth counts as alive. */
  readonly received: () => number;
  /** FIX-CMT: the longest the call may take from its start, streaming or not. Unset: no deadline. */
  readonly deadlineMs?: number;
}): StallWatch {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const started = Date.now();
  let last = started;
  let bytes = options.received();
  let stalled = false;
  let overDeadline = false;
  const tick = Math.max(10, Math.min(5_000, Math.floor(Math.min(options.stallMs, options.deadlineMs ?? Infinity) / 4)));
  const timer = setInterval(() => {
    const now = Date.now();
    if (options.deadlineMs !== undefined && now - started >= options.deadlineMs) {
      stalled = overDeadline = true;
      clearInterval(timer);
      controller.abort(new Error(`The model's answer ran past ${Math.round(options.deadlineMs / 1000)} s`));
      return;
    }
    const seen = options.received();
    if (seen !== bytes) {
      bytes = seen;
      last = now;
      return;
    }
    if (now - last < options.stallMs) return;
    stalled = true;
    clearInterval(timer);
    controller.abort(new Error(`No data from the model for ${Math.round(options.stallMs / 1000)} s`));
  }, tick);
  timer.unref?.();
  return {
    signal,
    alive() {
      last = Date.now();
    },
    get stalled() {
      return stalled;
    },
    get overDeadline() {
      return overDeadline;
    },
    stop() {
      clearInterval(timer);
    },
  };
}
