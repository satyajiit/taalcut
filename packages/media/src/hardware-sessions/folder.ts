// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The slot folder every process shares. `slot-<n>` is one held hardware
 * session; `wait-<ms>-<token>` is a process waiting for some, oldest first.
 * Each file holds `{ pid, token, weight }` and its mtime is the holder's
 * heartbeat. Files are created complete and exclusively: written aside, then
 * hard-linked into place (`link` fails when the name exists), so a reader
 * never sees half a record and two processes never hold one slot. A slot also
 * names the processes that hold its session (`children`: pid, and start time
 * once `ps` gave it; IX3-F5 H4, IX3-F7), rewritten synchronously aside and
 * renamed over the holder's own file, so the pid is on disk before the call
 * that names it returns.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { link, readdir, readFile, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SLOT = /^slot-(\d+)$/;
export const WAITER = /^wait-\d{15}-[0-9a-f]+$/;
export const TEMP = /^\.tmp-/;

/**
 * A process that holds the session itself (a detached FFmpeg, the mac helper during a request): its pid, and its `ps`
 * start once known. Without a start, the live pid alone keeps the slot.
 */
export interface SessionChild {
  readonly pid: number;
  readonly started?: string;
}

export interface Holder {
  readonly pid: number;
  readonly token: string;
  readonly weight: number;
  readonly children?: readonly SessionChild[];
}

export interface Entry {
  readonly name: string;
  /** Undefined when the record can't be read (it is then live until it goes stale by age). */
  readonly holder: Holder | undefined;
  readonly mtimeMs: number;
}

export const newToken = (): string => randomBytes(8).toString('hex');

const code = (cause: unknown) => (cause as NodeJS.ErrnoException | undefined)?.code;

/** Creates `dir/name` holding `holder`, only if nothing has that name. False when it exists. */
export async function createExclusive(dir: string, name: string, holder: Holder): Promise<boolean> {
  const temp = join(dir, `.tmp-${holder.token}-${name}`);
  await writeFile(temp, JSON.stringify(holder));
  try {
    await link(temp, join(dir, name));
    return true;
  } catch (cause) {
    if (code(cause) === 'EEXIST') return false;
    throw cause;
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

function parseHolder(text: string): Holder | undefined {
  try {
    const value = JSON.parse(text) as Partial<Holder>;
    if (typeof value.pid !== 'number' || typeof value.token !== 'string') return undefined;
    const children = Array.isArray(value.children) ? value.children.filter(isChild) : [];
    return {
      pid: value.pid,
      token: value.token,
      weight: typeof value.weight === 'number' ? value.weight : 1,
      ...(children.length > 0 ? { children } : {}),
    };
  } catch {
    return undefined;
  }
}

function isChild(value: unknown): value is SessionChild {
  const child = value as Partial<SessionChild> | null;
  return typeof child?.pid === 'number' && (child.started === undefined || typeof child.started === 'string');
}

/** The entry called `name`, or undefined when it is gone. */
export async function readEntry(dir: string, name: string): Promise<Entry | undefined> {
  const path = join(dir, name);
  try {
    const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    return { name, holder: parseHolder(text), mtimeMs: info.mtimeMs };
  } catch (cause) {
    if (code(cause) === 'ENOENT') return undefined;
    throw cause;
  }
}

export interface Survey {
  /** Held slots by index. */
  readonly slots: ReadonlyMap<number, Entry>;
  /** Waiters, oldest first. */
  readonly waiters: readonly Entry[];
  /** Leftovers of a process that died between writing and linking. */
  readonly temps: readonly Entry[];
}

export async function survey(dir: string): Promise<Survey> {
  const names = await readdir(dir);
  const slots = new Map<number, Entry>();
  const waiters: Entry[] = [];
  const temps: Entry[] = [];
  await Promise.all(
    names.map(async (name) => {
      const slot = SLOT.exec(name);
      if (!slot && !WAITER.test(name) && !TEMP.test(name)) return;
      const entry = await readEntry(dir, name);
      if (!entry) return;
      if (slot) slots.set(Number(slot[1]), entry);
      else if (WAITER.test(name)) waiters.push(entry);
      else temps.push(entry);
    }),
  );
  waiters.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { slots, waiters, temps };
}

/** Removes the named entries that still carry `token`; another holder's file is left alone. */
export async function removeOwned(dir: string, names: readonly string[], token: string): Promise<void> {
  await Promise.all(
    names.map(async (name) => {
      const entry = await readEntry(dir, name).catch(() => undefined);
      if (entry?.holder?.token === token) await unlink(join(dir, name)).catch(() => undefined);
    }),
  );
}

/**
 * Rewrites, synchronously, the named entries that still carry `holder.token` with `holder`: written aside, then
 * renamed over, so a reader sees the old record or the new one and a failed write leaves the old one.
 */
export function rewriteOwnedSync(dir: string, names: readonly string[], holder: Holder): void {
  for (const name of names) {
    const path = join(dir, name);
    const text = readIfThere(path);
    if (text === undefined || parseHolder(text)?.token !== holder.token) continue;
    const temp = join(dir, `.tmp-${holder.token}-${name}-children`);
    writeFileSync(temp, JSON.stringify(holder));
    try {
      renameSync(temp, path);
    } catch (cause) {
      unlinkSync(temp);
      throw cause;
    }
  }
}

function readIfThere(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (cause) {
    if (code(cause) === 'ENOENT') return undefined;
    throw cause;
  }
}

/** Touches the files every `intervalMs`, so other processes see the holder is alive. */
export function heartbeat(dir: string, names: readonly string[], intervalMs: number): { stop(): void } {
  const timer = setInterval(() => {
    const now = new Date();
    for (const name of names) void utimes(join(dir, name), now, now).catch(() => undefined);
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
