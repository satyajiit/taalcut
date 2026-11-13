// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A counting semaphore for hardware video sessions shared by every process
 * of the app (jobs, render, and any other that runs FFmpeg), through a
 * folder (folder.ts). No broker and no IPC: a process that dies keeps no
 * slot, because a slot whose pid is gone, or whose heartbeat stopped, is
 * swept, unless a process it started still holds the session: a slot that
 * names its FFmpeg (`adopt`) stays held while that same process runs, with no
 * time cap (IX3-F5, H4). Waiters queue oldest first, so a two-session
 * transcode is not starved by a stream of one-session frame grabs.
 *
 * If the folder can't be used (or isn't this user's alone: location.ts) the gate still caps this process, in
 * memory, and says so once in the log: a cap that only holds per process is better than none, and failing every
 * encode is worse.
 */
import { mkdir, rmdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import { MediaCancelled } from '../errors';
import {
  createExclusive,
  heartbeat,
  newToken,
  readEntry,
  removeOwned,
  survey,
  type Entry,
  type Holder,
  type Survey,
} from './folder';
import { folderLease } from './folder-lease';
import { createLocalSemaphore } from './local';
import { ensurePrivateFolder } from './location';
import { processStart, type ProcessStart } from './process-start';
import { createStaleness } from './staleness';
import type { HardwareSessionGate, HardwareSessionLease } from './types';

export type { HardwareSessionGate, HardwareSessionLease } from './types';

export interface HardwareSessionGateOptions {
  /** The shared folder (`hardwareSessionFolder()`). Every process of the app must use the same one; made 0700. */
  readonly dir: string;
  /** Sessions allowed at once. A function is called once, at the first acquire (the tier probe is slow). */
  readonly limit: number | (() => number | Promise<number>);
  /** Default process.pid; tests give several gates different pids to stand for several processes. */
  readonly pid?: number;
  /** Default `process.kill(pid, 0)`. */
  readonly isAlive?: (pid: number) => boolean;
  /** How often a waiter looks again. Default 200 ms, spread ±25%. */
  readonly pollMs?: number;
  /** How often a holder touches its files. Default 15 s. */
  readonly heartbeatMs?: number;
  /**
   * A record whose heartbeat is older than this is swept even if its pid lives (pid reuse), unless a session
   * child it names still runs. Default 2 min.
   */
  readonly staleMs?: number;
  /** When a process started (`ps`); tests stand in for it. */
  readonly startOf?: (pid: number) => Promise<ProcessStart>;
  readonly log?: (line: string) => void;
}

const CLEANER = '.clean';
const CLEANER_STALE_MS = 10_000;

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    // EPERM: it exists and belongs to someone else.
    return (cause as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const cancelled = (): TaalcutError =>
  MediaCancelled(undefined, { detail: 'aborted waiting for a hardware session' });

function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

export function createHardwareSessionGate(options: HardwareSessionGateOptions): HardwareSessionGate {
  const { dir } = options;
  const pid = options.pid ?? process.pid;
  const isAlive = options.isAlive ?? processAlive;
  const pollMs = options.pollMs ?? 200;
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const staleMs = options.staleMs ?? 120_000;
  const log = options.log ?? ((line: string) => console.warn(`[media] ${line}`));
  const startOf = options.startOf ?? processStart;
  const { stale, staleOnes } = createStaleness({ staleMs, isAlive, startOf, log });
  const said = new Set<string>();
  const logOnce = (key: string, line: string) => {
    if (said.has(key)) return;
    said.add(key);
    log(line);
  };
  const local = createLocalSemaphore();
  let limit: Promise<number> | undefined;
  let folder: Promise<boolean> | undefined;
  let warned = false;

  const resolveLimit = () =>
    (limit ??= Promise.resolve()
      .then(() => (typeof options.limit === 'function' ? options.limit() : options.limit))
      .then((n) => Math.max(1, Math.floor(n)))
      .catch(() => 1));
  const ready = () =>
    (folder ??= ensurePrivateFolder(dir).then(
      () => true,
      (cause: unknown) => degrade(cause),
    ));
  function degrade(cause: unknown): false {
    if (!warned) log(`hardware session folder unusable, capping this process only: ${String(cause)}`);
    warned = true;
    return false;
  }

  /** Removes stale records, one cleaner at a time (only a cleaner removes another's file). */
  async function sweep(view: Survey): Promise<void> {
    const candidates = [...(await staleOnes([...view.slots.values(), ...view.waiters, ...view.temps]))];
    if (candidates.length === 0) return;
    const lock = join(dir, CLEANER);
    try {
      await mkdir(lock);
    } catch {
      const age = await stat(lock).then(
        (s) => Date.now() - s.mtimeMs,
        () => 0,
      );
      if (age > CLEANER_STALE_MS) await rmdir(lock).catch(() => undefined);
      return;
    }
    try {
      for (const candidate of candidates) {
        const again = await readEntry(dir, candidate.name);
        if (!again || !(await stale(again))) continue;
        await unlink(join(dir, candidate.name)).catch(() => undefined);
        if (again.holder) log(`swept hardware session record ${candidate.name} of pid ${again.holder.pid}`);
      }
    } finally {
      await rmdir(lock).catch(() => undefined);
    }
  }

  /** One look at the folder: holds `want` slots if they are free and nobody older is waiting for them. */
  async function attempt(
    holder: Holder,
    waiter: string,
    max: number,
  ): Promise<HardwareSessionLease | undefined> {
    const view = await survey(dir);
    await sweep(view);
    const gone = await staleOnes([...view.slots.values(), ...view.waiters]);
    const live = (entry: Entry) => !gone.has(entry);
    // A waiter whose token holds slots was let in and removes its record next: its weight is in the slots,
    // so counting it ahead too kept free ones idle until it was gone (a look later; longer on a busy Mac).
    const holding = new Set(
      [...view.slots.values()].flatMap((entry) => (entry.holder && live(entry) ? [entry.holder.token] : [])),
    );
    const admitted = (entry: Entry) => entry.holder !== undefined && holding.has(entry.holder.token);
    const ahead = view.waiters
      .filter((entry) => entry.name < waiter && live(entry) && !admitted(entry))
      .reduce((sum, entry) => sum + (entry.holder?.weight ?? 1), 0);
    const free: number[] = [];
    for (let index = 0; index < max; index++) {
      const held = view.slots.get(index);
      if (!held || !live(held)) free.push(index);
    }
    if (free.length - ahead < holder.weight) return undefined;
    const taken: string[] = [];
    for (const index of free) {
      if (taken.length === holder.weight) break;
      if (await createExclusive(dir, `slot-${index}`, holder)) taken.push(`slot-${index}`);
    }
    if (taken.length === holder.weight)
      return folderLease(dir, taken, holder, { heartbeatMs, startOf, isAlive, log, logOnce });
    await removeOwned(dir, taken, holder.token);
    return undefined;
  }

  async function acquire(
    weight: number,
    signal?: AbortSignal,
    retried = false,
  ): AsyncResult<HardwareSessionLease> {
    if (signal?.aborted) return err(cancelled());
    const max = await resolveLimit();
    const want = Math.min(max, Math.max(1, Math.ceil(weight)));
    if (!(await ready())) return local.acquire(want, max, signal);
    const holder: Holder = { pid, token: newToken(), weight: want };
    const waiter = `wait-${String(Date.now()).padStart(15, '0')}-${holder.token}`;
    let beat: { stop(): void } | undefined;
    try {
      await createExclusive(dir, waiter, holder);
      beat = heartbeat(dir, [waiter], heartbeatMs);
      for (;;) {
        if (signal?.aborted) return err(cancelled());
        const held = await attempt(holder, waiter, max);
        if (held) return ok(held);
        await pause(pollMs * (0.75 + Math.random() / 2), signal);
      }
    } catch (cause) {
      // The folder went away (a temp cleaner): make it again once, then cap in memory.
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT' && !retried) {
        folder = undefined;
        return acquire(weight, signal, true);
      }
      degrade(cause);
      return local.acquire(want, max, signal);
    } finally {
      beat?.stop();
      await removeOwned(dir, [waiter], holder.token).catch(() => undefined);
    }
  }

  async function inUse(): Promise<number> {
    if (!(await ready())) return local.inUse();
    const view = await survey(dir);
    const slots = [...view.slots.values()];
    return slots.length - (await staleOnes(slots)).size;
  }

  return { acquire, limit: resolveLimit, inUse };
}
