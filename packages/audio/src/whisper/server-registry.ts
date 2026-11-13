// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The second line behind each server's watchdog (server-spawn.ts, IX-F7): macOS has no parent-death signal, and a
 * server left by a killed jobs process holds its model in memory. Each launch is written down (`<owner pid>-<server
 * pid>.json`: port and path); the next jobs process sweeps them at its start and stops the ones whose owner is gone.
 * A recorded pid may since belong to another program, so a server is only stopped when it still answers on its port
 * under its random path: nothing else can.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jsonFromText } from '@taalcut/core';
import { z } from 'zod';
import type { FetchFn } from './server-process';

const entrySchema = z.object({
  owner: z.int().positive(),
  pid: z.int().positive(),
  port: z.int().min(1).max(65_535),
  secret: z.string().regex(/^[0-9a-f]{32}$/),
});
export type ServerEntry = z.output<typeof entrySchema>;

export interface ServerRegistry {
  record(entry: ServerEntry): Promise<void>;
  forget(entry: Pick<ServerEntry, 'owner' | 'pid'>): Promise<void>;
  /** Stops orphaned servers and removes their records; returns how many it stopped. */
  sweep(): Promise<number>;
}

export interface ServerRegistryDeps {
  readonly dir: string;
  readonly fetch: FetchFn;
  readonly isAlive: (pid: number) => boolean;
  /** Signals the server's process group. */
  readonly kill: (pid: number) => void;
}

const fileOf = (dir: string, entry: Pick<ServerEntry, 'owner' | 'pid'>) =>
  join(dir, `${entry.owner}-${entry.pid}.json`);

async function answers(fetch: FetchFn, entry: ServerEntry): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${entry.port}/${entry.secret}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    await response.body?.cancel();
    // 200 ready, 503 still loading: either way it is ours.
    return response.status === 200 || response.status === 503;
  } catch {
    return false;
  }
}

export function createServerRegistry(deps: ServerRegistryDeps): ServerRegistry {
  return {
    async record(entry) {
      await mkdir(deps.dir, { recursive: true });
      await writeFile(fileOf(deps.dir, entry), JSON.stringify(entry));
    },
    async forget(entry) {
      await rm(fileOf(deps.dir, entry), { force: true });
    },
    async sweep() {
      let stopped = 0;
      const names = await readdir(deps.dir).catch(() => [] as string[]);
      for (const name of names.filter((n) => n.endsWith('.json'))) {
        const path = join(deps.dir, name);
        const parsed = entrySchema.safeParse(jsonFromText(await readFile(path, 'utf8').catch(() => '')));
        if (!parsed.success) {
          await rm(path, { force: true });
          continue;
        }
        const entry = parsed.data;
        if (deps.isAlive(entry.owner)) continue;
        if (deps.isAlive(entry.pid) && (await answers(deps.fetch, entry))) {
          deps.kill(entry.pid);
          stopped += 1;
        }
        await rm(path, { force: true });
      }
      return stopped;
    },
  };
}
