// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One whisper-server slot of the pool (one binary and model): its process, the requests queued for it, and the
 * idle timer that stops the process nobody asked for. Requests run one at a time, in order; a process that has
 * exited is replaced by the next request; a launch that failed is not kept.
 */
import { createSerialQueue, type Result, type SerialQueue } from '@taalcut/core';
import type { WhisperServerProcess } from './server-process';

export interface Slot {
  process?: Promise<Result<WhisperServerProcess>>;
  /** Requests waiting or running. */
  inFlight: number;
  readonly queue: SerialQueue;
  idle?: NodeJS.Timeout;
  /** The GPU failed (or was not found) for this model: start on the CPU from now on. */
  cpu: boolean;
  fallbackSent: boolean;
}

export function newSlot(): Slot {
  return { inFlight: 0, queue: createSerialQueue(), cpu: false, fallbackSent: false };
}

/** The slot's running process, or one `start` launches when it has none or its process has exited. */
export async function slotProcess(
  slot: Slot,
  start: () => Promise<Result<WhisperServerProcess>>,
): Promise<Result<WhisperServerProcess>> {
  const current = slot.process;
  if (current) {
    const settled = await current;
    if (settled.ok && settled.value.alive()) return settled;
    if (slot.process === current) slot.process = undefined;
  }
  const pending = (slot.process ??= start());
  const started = await pending;
  // A failed launch is not kept: the next request tries again.
  if (!started.ok && slot.process === pending) slot.process = undefined;
  return started;
}

/** Stops the slot's process after `idleMs` with nothing in flight (a request in between cancels it). */
function armIdle(slot: Slot, idleMs: number): void {
  clearTimeout(slot.idle);
  if (slot.inFlight > 0 || !slot.process) return;
  const current = slot.process;
  slot.idle = setTimeout(() => {
    if (slot.inFlight > 0 || slot.process !== current) return;
    slot.process = undefined;
    void current.then((started) => (started.ok ? started.value.stop() : undefined));
  }, idleMs);
  slot.idle.unref();
}

/** Runs `work` after the slot's earlier requests; the idle timer starts again once the slot is empty. */
export function enqueue<T>(slot: Slot, idleMs: number, work: () => Promise<T>): Promise<T> {
  slot.inFlight += 1;
  clearTimeout(slot.idle);
  // The queue only orders requests; each caller gets its own answer.
  return slot.queue.run(work).finally(() => {
    slot.inFlight -= 1;
    armIdle(slot, idleMs);
  });
}

/** Stops the slot's timer and process (the pool is closing). */
export async function stopSlot(slot: Slot): Promise<void> {
  clearTimeout(slot.idle);
  const started = slot.process ? await slot.process : undefined;
  slot.process = undefined;
  if (started?.ok) await started.value.stop();
}
