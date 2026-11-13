// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A model "process" for the lifecycle tests (IX2-S2): the client's channel and the model's served end over a
 * real MessageChannel (messages are cloned and arrive on a later turn, as between processes), with hooks for
 * what a process does to its client: crash (its port closes), send something outside the protocol, never
 * answer. And timers the test moves by hand.
 */
import { MessageChannel } from 'node:worker_threads';
import type { AsyncResult } from '@taalcut/core';
import type { ToModel } from '../../src/cuts/model-protocol';
import { serveShotModel, type ServeEnd } from '../../src/cuts/model-serve';
import type { ModelChannel, ModelTimers } from '../../src/cuts/model-session';
import type { ShotBoundaryModel } from '../../src/cuts/transnet';
import { WINDOW_FRAMES } from '../../src/cuts/windows';

export interface ModelPair {
  readonly channel: ModelChannel;
  /** Settles when the served side ends. */
  readonly served: Promise<ServeEnd>;
  /** Every message the client sent, in order. */
  readonly sent: ToModel[];
  /** True once the client closed its end. */
  readonly closed: boolean;
  /** The process dies: its end of the port closes. */
  crash(): void;
  /** A raw message from the model's side. */
  post(raw: unknown): void;
}

export function modelPair(open: (modelDir: string) => AsyncResult<ShotBoundaryModel>): ModelPair {
  const { port1, port2 } = new MessageChannel();
  port1.unref();
  port2.unref();
  const sent: ToModel[] = [];
  let closed = false;
  const channel: ModelChannel = {
    send(message) {
      sent.push(message);
      port1.postMessage(message);
    },
    onMessage: (listener) => void port1.on('message', listener),
    onGone: (listener) => void port1.once('close', () => listener('the model port closed')),
    close() {
      closed = true;
      port1.close();
    },
  };
  const served = serveShotModel(
    {
      send: (message) => port2.postMessage(message),
      onMessage: (listener) => void port2.on('message', listener),
      onGone: (listener) => void port2.once('close', listener),
    },
    open,
  );
  return {
    channel,
    served,
    sent,
    get closed() {
      return closed;
    },
    crash: () => port2.close(),
    post: (raw) => port2.postMessage(raw),
  };
}

/** setTimeout by hand: `advance` runs what has come due, in order. */
export function manualTimers(): ModelTimers & { advance(ms: number): void; readonly pending: number } {
  const due = new Map<number, { at: number; run: () => void }>();
  let now = 0;
  let next = 0;
  return {
    setTimeout(run, ms) {
      next += 1;
      due.set(next, { at: now + ms, run });
      return next;
    },
    clearTimeout(handle) {
      if (typeof handle === 'number') due.delete(handle);
    },
    advance(ms) {
      now += ms;
      const ready = [...due].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at);
      for (const [handle, timer] of ready) {
        due.delete(handle);
        timer.run();
      }
    },
    get pending() {
      return due.size;
    },
  };
}

/** A window of gray levels: frame i is `levels[i]` (0 after the list). */
export function grayWindow(levels: readonly number[]): Float32Array {
  const size = 48 * 27 * 3;
  const out = new Float32Array(WINDOW_FRAMES * size);
  levels.forEach((level, i) => out.fill(level, i * size, (i + 1) * size));
  return out;
}

/** A model whose windows never finish (a long run, or a hung one). */
export function stuckModel(model: ShotBoundaryModel): ShotBoundaryModel {
  return { ...model, predict: () => new Promise(() => undefined) };
}

/** Lets messages cross the channel and their handlers run. */
export async function settle(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((resolve) => setImmediate(resolve));
}
