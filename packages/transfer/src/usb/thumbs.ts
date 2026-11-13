// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * JPEG thumbs under stateDir/usb/thumbs/<deviceKey>/<itemKey>.jpg. At most 4
 * at once, one job per file. A clear drops the queue and keeps jobs already
 * running from writing; the pool takes new work straight after.
 */
import { access, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { err, ok, toTaalcutError, type AsyncResult } from '@taalcut/core';
import type { BridgeSession } from './bridge';
import { writeAtomic } from './fs-atomic';

const PARALLEL = 4;

export function thumbPath(stateDir: string, deviceKey: string, itemKey: string): string {
  return join(stateDir, 'usb', 'thumbs', deviceKey, `${itemKey}.jpg`);
}

export function thumbDir(stateDir: string, deviceKey: string): string {
  return join(stateDir, 'usb', 'thumbs', deviceKey);
}

export async function thumbExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    // Missing or unreadable: either way there is no thumb to serve.
    return false;
  }
}

export async function clearThumbs(stateDir: string, deviceKey: string): AsyncResult<void> {
  try {
    await rm(thumbDir(stateDir, deviceKey), { recursive: true, force: true });
    return ok(undefined);
  } catch (cause) {
    return err(toTaalcutError(cause));
  }
}

export interface ThumbPool {
  fetch(session: BridgeSession, itemId: string, dest: string, signal: AbortSignal): void;
  clear(): void;
}

interface Job {
  readonly session: BridgeSession;
  readonly itemId: string;
  readonly dest: string;
  readonly signal: AbortSignal;
  readonly generation: number;
}

export function createThumbPool(log?: { info(line: string): void }): ThumbPool {
  let active = 0;
  let generation = 0;
  let poolAbort = new AbortController();
  const waiting: Job[] = [];
  /** Queued or running, by destination: two rows for one item make one job. */
  const jobs = new Map<string, Job>();

  function pump(): void {
    while (active < PARALLEL && waiting.length > 0) {
      const job = waiting.shift();
      if (!job) return;
      active += 1;
      void runJob(job);
    }
  }

  async function runJob(job: Job): Promise<void> {
    const made = await produce(job, () => job.generation === generation);
    if (!made.ok) log?.info(`usb thumb ${made.error.code}`);
    active -= 1;
    if (jobs.get(job.dest) === job) jobs.delete(job.dest);
    pump();
  }

  return {
    fetch(session, itemId, dest, signal) {
      if (signal.aborted || jobs.has(dest)) return;
      const combined = AbortSignal.any([signal, poolAbort.signal]);
      const job: Job = { session, itemId, dest, signal: combined, generation };
      jobs.set(dest, job);
      waiting.push(job);
      pump();
    },
    clear() {
      generation += 1;
      poolAbort.abort();
      poolAbort = new AbortController();
      for (const job of waiting) jobs.delete(job.dest);
      waiting.length = 0;
    },
  };
}

async function produce(job: Job, live: () => boolean): AsyncResult<void> {
  try {
    if (job.signal.aborted || !live() || (await thumbExists(job.dest))) return ok(undefined);
    const result = await job.session.thumbnail(job.itemId, job.signal);
    if (!result.ok) return result;
    const bytes = result.value;
    if (!bytes || bytes.length === 0 || job.signal.aborted || !live()) return ok(undefined);
    await mkdir(dirname(job.dest), { recursive: true });
    await writeAtomic(job.dest, bytes);
    return ok(undefined);
  } catch (cause) {
    return err(toTaalcutError(cause));
  }
}
