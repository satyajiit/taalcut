// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * When a record in the session folder is no longer used (gate.ts sweeps it and counts its slot free): its
 * heartbeat stopped or its holder died, and no session child it names still runs. A child that outlives its holder
 * keeps the slot however long it runs, with no time cap (IX3-F5, H4); ProcessRun logs its stall line.
 */
import type { Entry, SessionChild } from './folder';
import type { ProcessStart } from './process-start';

export interface StalenessOptions {
  readonly staleMs: number;
  readonly isAlive: (pid: number) => boolean;
  readonly startOf: (pid: number) => Promise<ProcessStart>;
  readonly log: (line: string) => void;
}

export interface Staleness {
  stale(entry: Entry): Promise<boolean>;
  /** The stale ones among `entries`. */
  staleOnes(entries: readonly Entry[]): Promise<Set<Entry>>;
}

export function createStaleness({ staleMs, isAlive, startOf, log }: StalenessOptions): Staleness {
  const keptBy = new Set<string>();

  const fresh = (entry: Entry) =>
    Date.now() - entry.mtimeMs <= staleMs && (entry.holder === undefined || isAlive(entry.holder.pid));

  /**
   * The same process as when the slot named it: its pid lives and started when it did (pid reuse). Named before its
   * start was known (or `ps` never gave one), the live pid alone keeps it.
   */
  async function runs(child: SessionChild): Promise<boolean> {
    if (!isAlive(child.pid)) return false;
    if (child.started === undefined) return true;
    const now = await startOf(child.pid);
    // A start that can't be read keeps the slot: a free slot beside a live session is what this guards against.
    return now.kind === 'unknown' || (now.kind === 'started' && now.at === child.started);
  }

  /** Says once per slot and child that a child keeps a slot its holder left. */
  function kept(entry: Entry, child: SessionChild): void {
    const key = `${entry.name}:${child.pid}`;
    if (keptBy.has(key)) return;
    keptBy.add(key);
    log(
      `hardware session ${entry.name} of pid ${entry.holder?.pid} stays held: its child pid ${child.pid} runs`,
    );
  }

  async function stale(entry: Entry): Promise<boolean> {
    if (fresh(entry)) return false;
    for (const child of entry.holder?.children ?? []) {
      if (!(await runs(child))) continue;
      kept(entry, child);
      return false;
    }
    return true;
  }

  async function staleOnes(entries: readonly Entry[]): Promise<Set<Entry>> {
    const flags = await Promise.all(entries.map(stale));
    return new Set(entries.filter((_, index) => flags[index]));
  }

  return { stale, staleOnes };
}
