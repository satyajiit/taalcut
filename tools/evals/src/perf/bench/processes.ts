// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A bench run's process samples (index-processes.jsonl) turned into numbers, over the indexing window only:
 *
 * - peak resident memory of the jobs utility process, of its whole tree (the jobs process plus every process
 *   it started: FFmpeg, whisper, the mac helper, and the utility processes main starts for it, which are
 *   main's children: the shot model, IX2-S2), and of each command in that tree (same-named processes alive at
 *   once are summed), and the same for the agent process (the local model server is its child);
 * - the endpoint security agents' CPU, from each process's cumulative CPU time between two samples (a
 *   process must appear in both; one that starts in between is counted from its next interval), per vendor
 *   and in total, as the time-weighted mean and the busiest interval, in percent of one core; the same for
 *   the macOS daemons that analyse the user's media meanwhile (mediaanalysisd, photoanalysisd, Spotlight);
 * - the one-minute load average while indexing ran;
 * - in how many samples each command of the app's tree was alive (the mac helper's shows whether OCR ran).
 */
import { basename } from 'node:path';
import type { ProcessSample, PsRow } from './run-record';

/** ps's cumulative CPU time, `[dd-][hh:]mm:ss.cc` (minutes may pass 59 without hours), in seconds. */
export function cpuSeconds(text: string): number {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text.trim());
  if (!match) throw new Error(`not a ps CPU time: '${text}'`);
  const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = match;
  return Number(days) * 86_400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

export interface TreeMemory {
  /** The utility process alone. */
  readonly peakBytes: number;
  /** The process and everything under it, and its helper processes and theirs, summed per sample. */
  readonly treePeakBytes: number;
  /** Per command name in the tree; the utility process itself is `self`, a helper process its utility name. */
  readonly peakByCommand: Readonly<Record<string, number>>;
}

/**
 * Utility processes that work for the jobs process but are main's children (only main can fork one; IX2-S2):
 * the shot model. Their memory is the jobs process's (the design's gate: jobs process and children, models
 * included), so each is summed into its tree per sample.
 */
const JOBS_HELPERS: readonly string[] = ['shot model'];

export interface CpuShare {
  readonly meanPercent: number;
  readonly maxPercent: number;
}

/** A group's CPU (security agents, background daemons), in total and per member group. */
export interface GroupCpu extends CpuShare {
  readonly byGroup: Readonly<Record<string, CpuShare>>;
}

export interface ProcessSummary {
  /** Samples inside the indexing window. */
  readonly samples: number;
  readonly jobs: TreeMemory | null;
  readonly agent: TreeMemory | null;
  /** Null with fewer than two samples in the window or no security agent seen. */
  readonly security: (CpuShare & { readonly byVendor: Readonly<Record<string, CpuShare>> }) | null;
  /** The macOS media daemons (mediaanalysisd, photoanalysisd, Spotlight's mdworker_shared summed); null likewise. */
  readonly background: GroupCpu | null;
  readonly load: { readonly mean: number; readonly max: number } | null;
  /** Per command name (basename) in the app's tree, the samples it was alive in. */
  readonly commandSamples: Readonly<Record<string, number>>;
}

function under(rows: readonly PsRow[], root: number): PsRow[] {
  const kept: PsRow[] = [];
  const queue = rows.filter((row) => row.pid === root);
  while (queue.length > 0) {
    const row = queue.shift();
    if (row === undefined) break;
    kept.push(row);
    queue.push(...rows.filter((child) => child.ppid === row.pid));
  }
  return kept;
}

/**
 * One sample's resident bytes per command name across the utility's tree and its helpers' trees: the utility
 * itself is `self`, a helper its utility name, and same-named processes are summed.
 */
function bytesByCommand(
  sample: ProcessSample,
  pid: number,
  tree: readonly PsRow[],
  helpers: readonly string[],
): Record<string, number> {
  const roots = new Map<number, string>([[pid, 'self']]);
  for (const helper of helpers) {
    const helperPid = sample.utilities[helper];
    if (helperPid !== undefined && !tree.some((row) => row.pid === helperPid)) roots.set(helperPid, helper);
  }
  const rows = [...roots.keys()].flatMap((root) => (root === pid ? tree : under(sample.rows, root)));
  const byCommand: Record<string, number> = {};
  for (const row of rows) {
    const name = roots.get(row.pid) ?? basename(row.command);
    byCommand[name] = (byCommand[name] ?? 0) + row.rssKb * 1024;
  }
  return byCommand;
}

function treeMemory(
  samples: readonly ProcessSample[],
  utility: string,
  helpers: readonly string[] = [],
): TreeMemory | null {
  let peakBytes = 0;
  let treePeakBytes = 0;
  const peakByCommand: Record<string, number> = {};
  let seen = false;
  for (const sample of samples) {
    const pid = sample.utilities[utility];
    if (pid === undefined) continue;
    const tree = under(sample.rows, pid);
    if (tree.length === 0) continue;
    seen = true;
    const byCommand = bytesByCommand(sample, pid, tree, helpers);
    const total = Object.values(byCommand).reduce((sum, bytes) => sum + bytes, 0);
    peakBytes = Math.max(peakBytes, byCommand.self ?? 0);
    treePeakBytes = Math.max(treePeakBytes, total);
    for (const [name, bytes] of Object.entries(byCommand))
      peakByCommand[name] = Math.max(peakByCommand[name] ?? 0, bytes);
  }
  return seen ? { peakBytes, treePeakBytes, peakByCommand } : null;
}

/** Which group a row's CPU counts toward (a security vendor, a background daemon), if any. */
type GroupOf = (row: PsRow) => string | undefined;

const byVendor: GroupOf = (row) => row.vendor;
const byDaemon: GroupOf = (row) => row.daemon;

interface Interval {
  readonly seconds: number;
  readonly cpuByGroup: Readonly<Record<string, number>>;
}

function cpuIntervals(samples: readonly ProcessSample[], groupOf: GroupOf): Interval[] {
  const intervals: Interval[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const before = samples[index - 1];
    const after = samples[index];
    if (before === undefined || after === undefined || after.at <= before.at) continue;
    const previous = new Map(before.rows.filter((row) => groupOf(row)).map((row) => [row.pid, row]));
    const cpuByGroup: Record<string, number> = {};
    for (const row of after.rows) {
      const group = groupOf(row);
      const earlier = previous.get(row.pid);
      if (group === undefined || earlier === undefined || earlier.command !== row.command) continue;
      const used = Math.max(0, cpuSeconds(row.cpu) - cpuSeconds(earlier.cpu));
      cpuByGroup[group] = (cpuByGroup[group] ?? 0) + used;
    }
    intervals.push({ seconds: (after.at - before.at) / 1000, cpuByGroup });
  }
  return intervals;
}

function share(intervals: readonly Interval[], pick: (interval: Interval) => number): CpuShare {
  const seconds = intervals.reduce((sum, interval) => sum + interval.seconds, 0);
  const used = intervals.reduce((sum, interval) => sum + pick(interval), 0);
  const maxPercent = Math.max(0, ...intervals.map((interval) => (pick(interval) / interval.seconds) * 100));
  return { meanPercent: seconds > 0 ? (used / seconds) * 100 : 0, maxPercent };
}

/** CPU of every group the rows name, in total and per group; null with no interval or no such row. */
function groupCpu(samples: readonly ProcessSample[], groupOf: GroupOf): GroupCpu | null {
  const intervals = cpuIntervals(samples, groupOf);
  const groups = [...new Set(samples.flatMap((sample) => sample.rows.flatMap((row) => groupOf(row) ?? [])))];
  if (intervals.length === 0 || groups.length === 0) return null;
  const total = (interval: Interval) => Object.values(interval.cpuByGroup).reduce((sum, cpu) => sum + cpu, 0);
  const byGroup = Object.fromEntries(
    groups.sort().map((group) => [group, share(intervals, (interval) => interval.cpuByGroup[group] ?? 0)]),
  );
  return { ...share(intervals, total), byGroup };
}

function security(samples: readonly ProcessSample[]): ProcessSummary['security'] {
  const cpu = groupCpu(samples, byVendor);
  return cpu === null
    ? null
    : { meanPercent: cpu.meanPercent, maxPercent: cpu.maxPercent, byVendor: cpu.byGroup };
}

function commandSamples(samples: readonly ProcessSample[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sample of samples)
    for (const name of new Set(under(sample.rows, sample.mainPid).map((row) => basename(row.command))))
      counts[name] = (counts[name] ?? 0) + 1;
  return counts;
}

/** The window is inclusive at both ends, in epoch ms (Add folder to settled). */
export function summariseProcesses(
  all: readonly ProcessSample[],
  window: { readonly from: number; readonly to: number },
): ProcessSummary {
  const samples = all.filter((sample) => sample.at >= window.from && sample.at <= window.to);
  const loads = samples.map((sample) => sample.load);
  return {
    samples: samples.length,
    jobs: treeMemory(samples, 'jobs', JOBS_HELPERS),
    agent: treeMemory(samples, 'agent'),
    security: security(samples),
    background: groupCpu(samples, byDaemon),
    load:
      loads.length === 0
        ? null
        : { mean: loads.reduce((sum, load) => sum + load, 0) / loads.length, max: Math.max(...loads) },
    commandSamples: commandSamples(samples),
  };
}
