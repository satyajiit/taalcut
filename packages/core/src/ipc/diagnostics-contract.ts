// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Diagnostics every process serves: ping, echo and a stream of ticks. They
 * prove a route end to end (renderer → main → utility process), name the
 * process and pid that answered, and let tests hold a call open across a
 * crash (`echo` with `delayMs`) or a stream across a restart (`ticks`).
 */
import '../basics/zod-config';
import { z } from 'zod';
import type { Clock } from '../basics/clock';
import { CancelledError } from '../basics/errors';
import { eventIterator, implementContract, ipc } from './contract';
import { PROCESS_NAMES, type ProcessName } from './processes';

const processSchema = z.enum(PROCESS_NAMES);

export const pongSchema = z.object({
  process: processSchema,
  pid: z.int().nonnegative(),
  /** The answering process's clock, epoch ms. */
  at: z.int().nonnegative(),
});
export type Pong = z.infer<typeof pongSchema>;

export const tickSchema = z.object({ process: processSchema, seq: z.int().nonnegative() });
export type Tick = z.infer<typeof tickSchema>;

export const diagnosticsContract = {
  ping: ipc.output(pongSchema),
  /** Returns `text`, after `delayMs` if given (the caller's AbortSignal cuts the wait short). */
  echo: ipc
    .input(z.object({ text: z.string().max(10_000), delayMs: z.int().min(0).max(60_000).optional() }))
    .output(z.object({ text: z.string(), process: processSchema })),
  /** `count` ticks, `intervalMs` apart (default 0), then the stream ends. */
  ticks: ipc
    .input(z.object({ count: z.int().min(1).max(1000), intervalMs: z.int().min(0).max(10_000).optional() }))
    .output(eventIterator(tickSchema)),
};

export interface DiagnosticsOptions {
  readonly process: ProcessName;
  readonly pid: number;
  readonly clock: Clock;
}

/** Resolves after `ms`, or rejects with core.cancelled when `signal` aborts first. */
function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(CancelledError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(CancelledError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function diagnosticsRouter({ process, pid, clock }: DiagnosticsOptions) {
  const os = implementContract(diagnosticsContract);
  return os.router({
    ping: os.ping.handler(() => ({ process, pid, at: clock.now() })),
    echo: os.echo.handler(async ({ input, signal }) => {
      if (input.delayMs) await wait(input.delayMs, signal);
      return { text: input.text, process };
    }),
    ticks: os.ticks.handler(async function* ({ input, signal }) {
      for (let seq = 0; seq < input.count; seq += 1) {
        if (seq > 0 && input.intervalMs) await wait(input.intervalMs, signal);
        yield { process, seq };
      }
    }),
  });
}
