// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the indexing bench records outside Electron's own metrics (IX-B1):
 * `ps` once a second, kept to the app's process tree (main, its utility
 * processes and everything they start: FFmpeg, whisper, the mac helper, the
 * local model server, which `app.getAppMetrics()` can't see) and to the
 * endpoint security agents (Sophos, FortiClient), whose CPU the bench
 * reports per run because they scan what indexing writes, and to the macOS
 * daemons that analyse the user's own media meanwhile (mediaanalysisd and
 * photoanalysisd use Vision, the Neural Engine and VideoToolbox, as OCR and
 * decode do; Spotlight's mdworker_shared reads files). Each sample also
 * names the utility processes' pids, so the jobs process's tree can be told
 * apart, and the one-minute load average. Raw rows go to index-processes.jsonl; tools/evals' bench analysis
 * turns them into peak memory and security-agent CPU (cumulative CPU time
 * between samples), so the arithmetic lives where it is unit-tested.
 */
import { execFile } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication } from '@playwright/test';

const run = promisify(execFile);

/** Endpoint security agents by vendor, matched on the executable's path or name. */
const SECURITY_VENDORS: readonly { readonly vendor: string; readonly pattern: RegExp }[] = [
  { vendor: 'sophos', pattern: /sophos/i },
  { vendor: 'fortinet', pattern: /fortinet|forticlient|fortimonitor|fortitray/i },
];

/** Background macOS daemons that compete for the same hardware, matched on the executable's name. */
const BACKGROUND_DAEMONS: readonly { readonly daemon: string; readonly pattern: RegExp }[] = [
  { daemon: 'mediaanalysisd', pattern: /(^|\/)mediaanalysisd$/ },
  { daemon: 'photoanalysisd', pattern: /(^|\/)photoanalysisd$/ },
  { daemon: 'spotlight', pattern: /(^|\/)mdworker_shared$/ },
];

export interface PsRow {
  readonly pid: number;
  readonly ppid: number;
  readonly rssKb: number;
  /** Cumulative CPU time as ps prints it ([dd-][hh:]mm:ss.cc). */
  readonly cpu: string;
  readonly command: string;
  readonly vendor?: string;
  /** A background daemon from BACKGROUND_DAEMONS (all mdworker_shared processes are `spotlight`). */
  readonly daemon?: string;
}

/** `ps -axo pid=,ppid=,rss=,time=,comm=`: the command is last and may hold spaces. */
function parsePs(text: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    if (!match) continue;
    const command = match[5]!.trim();
    const vendor = SECURITY_VENDORS.find((entry) => entry.pattern.test(command))?.vendor;
    const daemon = BACKGROUND_DAEMONS.find((entry) => entry.pattern.test(command))?.daemon;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssKb: Number(match[3]),
      cpu: match[4]!,
      command,
      ...(vendor ? { vendor } : {}),
      ...(daemon ? { daemon } : {}),
    });
  }
  return rows;
}

/** `root` and every process under it. */
function tree(rows: readonly PsRow[], root: number): PsRow[] {
  const children = new Map<number, PsRow[]>();
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row]);
  const kept: PsRow[] = [];
  const queue = rows.filter((row) => row.pid === root);
  while (queue.length > 0) {
    const row = queue.shift()!;
    kept.push(row);
    queue.push(...(children.get(row.pid) ?? []));
  }
  return kept;
}

/** The app's utility processes by name ('Taalcut jobs' → 'jobs'), from Electron's own list. */
async function utilityPids(app: ElectronApplication): Promise<Record<string, number>> {
  const metrics = await app.evaluate(({ app: main }) =>
    main.getAppMetrics().map((metric) => ({ pid: metric.pid, type: metric.type, name: metric.name ?? '' })),
  );
  const pids: Record<string, number> = {};
  for (const metric of metrics)
    if (metric.type === 'Utility' && metric.name.startsWith('Taalcut '))
      pids[metric.name.slice('Taalcut '.length).toLowerCase()] = metric.pid;
  return pids;
}

export interface ProcessRecorder {
  /** Stops recording; how many samples were written. */
  stop(): Promise<{ readonly samples: number; readonly file: string }>;
}

/** Records the app's process tree and the security agents every `everyMs` into `file` (replaced) until stop(). */
export function recordProcesses(app: ElectronApplication, file: string, everyMs = 1000): ProcessRecorder {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '');
  const mainPid = app.process().pid;
  let samples = 0;
  let stopped = false;

  const loop = (async () => {
    while (!stopped) {
      // The app may be closing: a sample it can't answer is simply not written.
      const sample = await Promise.all([
        run('ps', ['-axo', 'pid=,ppid=,rss=,time=,comm='], { maxBuffer: 8 * 1024 * 1024 }),
        utilityPids(app),
      ]).catch(() => null);
      if (sample && mainPid !== undefined) {
        const [ps, utilities] = sample;
        const rows = parsePs(ps.stdout);
        const kept = [
          ...tree(rows, mainPid),
          ...rows.filter((row) => row.vendor !== undefined || row.daemon !== undefined),
        ];
        const load = loadavg()[0] ?? 0;
        appendFileSync(file, `${JSON.stringify({ at: Date.now(), load, mainPid, utilities, rows: kept })}\n`);
        samples += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, everyMs));
    }
  })();

  return {
    async stop() {
      stopped = true;
      await loop;
      return { samples, file };
    },
  };
}
