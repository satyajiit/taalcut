// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The workspace shell's process watch (AGT2 sbx). macOS has no memory rlimit (`ulimit -v`, `-m` and `-d` are refused
 * on macOS 27) and no cgroups, so the shell's memory is watched from outside: every poll lists this user's
 * processes with `ps` and follows the tree the shell started. A process belongs to it when it is the shell, is in
 * its process group, has a parent that belongs, or was seen belonging before (with the same start time, so a pid
 * the system handed to someone else is never counted or signalled). That last rule keeps a child that left the
 * group (`setsid`) or was orphaned in view once a poll has seen it.
 *
 * Ending signals the group and every tracked process that is still the one seen: only processes this shell started.
 */
import { execFile } from 'node:child_process';

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  /** Resident memory, KiB (ps's `rss`). */
  readonly rssKiB: number;
  /** ps's `lstart`: when it started, to the second; with the pid, who it is. */
  readonly started: string;
}

export type ListProcesses = () => Promise<readonly ProcessRow[]>;

const ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/;

/** `ps`'s rows for `-o pid=,ppid=,pgid=,rss=,lstart=`; lines it can't read are skipped. */
export function parsePs(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split('\n')) {
    const match = ROW.exec(line);
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      rssKiB: Number(match[4]),
      started: match[5]!,
    });
  }
  return rows;
}

/** This user's processes, by `ps` (macOS and Linux both take these options). */
export function psProcesses(uid: number = process.getuid?.() ?? 0, ps = 'ps'): ListProcesses {
  const args = ['-U', String(uid), '-o', 'pid=,ppid=,pgid=,rss=,lstart='];
  return () =>
    new Promise((resolve) => {
      execFile(
        ps,
        args,
        { maxBuffer: 8 * 1024 * 1024, env: { LC_ALL: 'C', PATH: '/bin:/usr/bin' } },
        (_e, out) =>
          // ps exits 1 when it lists nothing; whatever it printed is still the answer.
          resolve(parsePs(String(out ?? ''))),
      );
    });
}

export interface TreeSample {
  /** Resident bytes of every process in the tree. */
  readonly rssBytes: number;
  readonly processes: number;
}

export interface ProcessTree {
  /** Lists once, adds what now belongs, and sums the tree. */
  poll(): Promise<TreeSample>;
  /** Signals the group and every tracked process still running as the one seen. Never throws. */
  signal(signal: NodeJS.Signals): Promise<number>;
  /** Tracked processes still running as the ones seen (after a fresh listing). */
  alive(): Promise<readonly ProcessRow[]>;
}

/** The tree the process `root` (a group leader: spawned `detached`) starts. */
export function trackTree(root: number, list: ListProcesses): ProcessTree {
  const seen = new Map<number, string>();

  const belonging = (rows: readonly ProcessRow[]): ProcessRow[] => {
    const members: ProcessRow[] = [];
    const inTree = new Set<number>();
    const add = (row: ProcessRow) => {
      if (inTree.has(row.pid)) return false;
      inTree.add(row.pid);
      members.push(row);
      seen.set(row.pid, row.started);
      return true;
    };
    for (const row of rows) {
      const known = seen.get(row.pid);
      if (row.pid === root || row.pgid === root || (known !== undefined && known === row.started)) add(row);
    }
    // Children of members, until nothing new joins (a parent may be listed after its child).
    for (let grew = true; grew;) {
      grew = false;
      for (const row of rows) if (!inTree.has(row.pid) && inTree.has(row.ppid) && add(row)) grew = true;
    }
    return members;
  };

  const alive = async () => {
    const rows = await list();
    return belonging(rows).filter((row) => row.pid === root || seen.get(row.pid) === row.started);
  };

  return {
    async poll() {
      const members = belonging(await list());
      return {
        rssBytes: members.reduce((sum, row) => sum + row.rssKiB * 1024, 0),
        processes: members.length,
      };
    },
    async signal(signal) {
      let sent = 0;
      const send = (pid: number) => {
        try {
          process.kill(pid, signal);
          sent += 1;
        } catch {
          // Already gone.
        }
      };
      send(root);
      send(-root);
      if (seen.size === 0) return sent;
      // A known child can leave the group between polls. Check its start time again before signalling its pid.
      for (const row of await alive()) if (row.pid !== root) send(row.pid);
      return sent;
    },
    alive,
  };
}
