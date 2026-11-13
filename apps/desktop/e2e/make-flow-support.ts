// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the make flow e2e (make-flow*.e2e.ts) needs around the app: a home
 * folder with the reels on its Desktop and the trip in Movies, the library
 * seeded as indexed (make-flow-seed.ts), HyperFrames' headless shell from
 * its own download cache, the test build's stand-ins
 * (recorded models, embeddings, beats) switched on, and the facts read back
 * from the library: the run's phases from its event log, the renders, and
 * the exported file's properties through ffprobe and an EBU R128 pass.
 */
import { execFile, execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { unwrap } from '@taalcut/core';
import {
  GATE_DEMO_FIXTURES,
  MAKE_FLOW_REFERENCE,
  MAKE_FLOW_SWAP_REFERENCE,
  REFERENCE_FOLDER,
} from '@taalcut/gate-demo';
import { measureLoudness, type ResolvedFfmpeg } from '@taalcut/media';
import { libraryPath } from '../src/shared/library-path';
import { SHELL_BINARY } from './headless-shell';
import { makeLibraryClips, makeReferenceReel } from './make-flow-media';
import { seedTripLibrary } from './make-flow-seed';

const run = promisify(execFile);

export interface MakeFlowHome {
  readonly home: string;
  readonly userData: string;
  /** The reels, by file name. */
  readonly reels: Readonly<Record<string, string>>;
  readonly trip: string;
  readonly shots: number;
}

/** The test's home (userData inside it, as on a Mac, so scratch paths are recorded under /Users/demo). */
export async function makeFlowHome(root: string, binaries: ResolvedFfmpeg): Promise<MakeFlowHome> {
  const home = join(realpathSync(root), 'home');
  const userData = join(home, 'Library', 'Application Support', 'Taalcut');
  mkdirSync(userData, { recursive: true });
  const desktop = join(home, REFERENCE_FOLDER);
  const reel = await makeReferenceReel(binaries, desktop, MAKE_FLOW_REFERENCE);
  const swap = join(desktop, MAKE_FLOW_SWAP_REFERENCE);
  copyFileSync(reel, swap);
  const trip = join(home, 'Movies', 'Trip');
  const files = await makeLibraryClips(binaries, trip);
  const seeded = seedTripLibrary(userData, trip, files);
  return {
    home,
    userData,
    trip,
    reels: { [MAKE_FLOW_REFERENCE]: reel, [MAKE_FLOW_SWAP_REFERENCE]: swap },
    shots: seeded.shots.length,
  };
}

/** The test build's stand-ins: recorded models, stand-in embeddings and beats; nothing to download. */
export function makeFlowEnv(home: string): Record<string, string> {
  return {
    HOME: home,
    TAALCUT_TEST_RECORDED_MODELS: GATE_DEMO_FIXTURES,
    TAALCUT_TEST_EMBEDDINGS: '1',
    TAALCUT_TEST_STANDIN_ANALYSERS: '1',
    TAALCUT_TEST_TELEMETRY_URL: 'http://127.0.0.1:9',
    // The component manager would install the shell; an unpackaged build takes this one instead.
    TAALCUT_HEADLESS_SHELL: SHELL_BINARY,
  };
}

export interface RenderRow {
  readonly id: string;
  readonly status: string;
  readonly timelineRevision: number;
  readonly filePath: string | null;
  readonly verdict: string | null;
  /** The QA checks that failed. */
  readonly failing: readonly string[];
  /** The QA checks that warned. */
  readonly warned: readonly string[];
  /** Time in QA, summed over its checks. */
  readonly qaMs: number;
  /** What each failing check found (target and measure), for failure messages. */
  readonly findings: readonly unknown[];
  readonly createdAt: number;
  readonly finishedAt: number | null;
}

export interface EventRow {
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly at: number;
}

/**
 * A reference's frames go to the vision model without a consent card (FIX-CONSENT, the owner's call, 2026-10-30).
 * Each is still logged for its call: approval.requested { kind: 'consent', reference: true }. Their count.
 */
export function referenceApprovals(events: readonly EventRow[]): number {
  return events.filter(
    (e) =>
      e.type === 'approval.requested' && e.payload['kind'] === 'consent' && e.payload['reference'] === true,
  ).length;
}

/** Warned checks and the time QA took, from a stored QA report. */
function qaChecks(report: string | null): { warned: string[]; qaMs: number; findings: unknown[] } {
  type Check = { id: string; status: string; durationMs?: number; findings?: unknown[] };
  const checks = report ? ((JSON.parse(report) as { checks?: Check[] }).checks ?? []) : [];
  return {
    warned: checks.filter((check) => check.status === 'warn').map((check) => check.id),
    qaMs: checks.reduce((sum, check) => sum + (check.durationMs ?? 0), 0),
    findings: checks.filter((check) => check.status === 'fail').map((check) => [check.id, check.findings]),
  };
}

/** The library, read while the app runs. */
export function makeFlowReader(userData: string) {
  const read = <T>(sql: string, ...params: (string | number)[]): T[] => {
    const db = new DatabaseSync(libraryPath(userData), { readOnly: true });
    try {
      return db.prepare(sql).all(...params) as T[];
    } finally {
      db.close();
    }
  };
  return {
    runFor: (message: string) =>
      read<{ run_id: string }>(
        'SELECT run_id FROM trace_runs WHERE message = ? ORDER BY started_at DESC LIMIT 1',
        message,
      )[0]?.run_id,
    events: (runId: string): EventRow[] =>
      read<{ type: string; payload: string; created_at: number }>(
        'SELECT type, payload, created_at FROM agent_events WHERE run_id = ? ORDER BY seq',
        runId,
      ).map((row) => ({
        type: row.type,
        // Stored versioned: { v, payload }.
        payload: (JSON.parse(row.payload) as { payload: Record<string, unknown> }).payload,
        at: row.created_at,
      })),
    renders: (): RenderRow[] =>
      read<{
        id: string;
        status: string;
        timeline_revision: number;
        file_path: string | null;
        qa: string | null;
        qa_report: string | null;
        created_at: number;
        finished_at: number | null;
      }>(
        'SELECT id, status, timeline_revision, file_path, qa, qa_report, created_at, finished_at FROM renders ORDER BY created_at',
      ).map((row) => ({
        id: row.id,
        status: row.status,
        timelineRevision: row.timeline_revision,
        filePath: row.file_path,
        verdict: row.qa ? ((JSON.parse(row.qa) as { verdict?: string }).verdict ?? null) : null,
        failing: row.qa ? ((JSON.parse(row.qa) as { failing?: string[] }).failing ?? []) : [],
        ...qaChecks(row.qa_report),
        createdAt: row.created_at,
        finishedAt: row.finished_at,
      })),
    cloudCalls: (runId: string) =>
      read<{ module: string; outcome: string; started_at: number }>(
        'SELECT module, outcome, started_at FROM cloud_calls WHERE run_id = ? ORDER BY started_at',
        runId,
      ),
    /** The commands a run's tools dispatched, from the audit log. */
    commandsOf: (runId: string) =>
      read<{ name: string; key: string | null; status: string }>(
        'SELECT name, idempotency_key AS key, status FROM commands WHERE actor = ? ORDER BY seq',
        `agent:${runId}`,
      ),
    /** The newest run: its status and last events, for failure messages. */
    latestRun: (): string => {
      const [run] = read<{ run_id: string; status: string }>(
        'SELECT run_id, status FROM agent_runs ORDER BY started_at DESC LIMIT 1',
      );
      if (!run) return 'no run';
      const last = read<{ type: string; payload: string }>(
        'SELECT type, payload FROM agent_events WHERE run_id = ? ORDER BY seq DESC LIMIT 6',
        run.run_id,
      )
        .reverse()
        .map((event) => `${event.type} ${event.payload.slice(0, 240)}`);
      // Every approval and card, in order: where the flow asked, and what the user (or nobody) answered.
      const asked = read<{ type: string; payload: string }>(
        `SELECT type, payload FROM agent_events WHERE run_id = ? AND type IN
         ('approval.requested', 'approval.granted', 'approval.denied', 'step.skipped', 'run.started', 'tool.failed')
         ORDER BY seq`,
        run.run_id,
      ).map((event) => `${event.type} ${event.payload.slice(0, 300)}`);
      return `run ${run.status}; approvals:\n${asked.join('\n')}\nlast events:\n${last.join('\n')}`;
    },
    jobs: () =>
      read<{ kind: string; state: string; error: string | null }>(
        'SELECT kind, state, error FROM jobs ORDER BY created_at',
      ),
    telemetry: () =>
      read<{ envelope: string }>('SELECT envelope FROM telemetry_outbox ORDER BY id').map(
        (row) => (JSON.parse(row.envelope) as { event: Record<string, unknown> }).event,
      ),
  };
}

/** Jobs by kind and state ('vision.describe:succeeded': 3): what ran, the flow's and indexing's alike. */
export function jobKinds(
  rows: readonly { readonly kind: string; readonly state: string }[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[`${row.kind}:${row.state}`] = (counts[`${row.kind}:${row.state}`] ?? 0) + 1;
  return counts;
}

/** How long each phase of a run took, from its event log: skill steps and the tools inside them. */
export function phaseTimings(events: readonly EventRow[]): Record<string, number> {
  const timings: Record<string, number> = {};
  const entered = new Map<string, number>();
  const tools = new Map<string, { tool: string; at: number }>();
  for (const event of events) {
    const p = event.payload;
    if (event.type === 'skill.entered') entered.set(String(p.stepId), event.at);
    if (event.type === 'skill.handedOff') {
      const from = entered.get(String(p.stepId));
      const key = `skill ${String(p.skill)}`;
      if (from !== undefined) timings[key] = (timings[key] ?? 0) + event.at - from;
    }
    if (event.type === 'tool.requested')
      tools.set(String(p.toolCallId), { tool: String(p.tool), at: event.at });
    if (event.type === 'tool.completed') {
      const call = tools.get(String(p.toolCallId));
      const key = `tool ${call?.tool ?? '?'}`;
      const ms = typeof p.durationMs === 'number' ? p.durationMs : call ? event.at - call.at : 0;
      timings[key] = (timings[key] ?? 0) + ms;
    }
  }
  return timings;
}

export interface ExportedFile {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly videoCodec: string;
  readonly audioCodec: string | null;
  readonly seconds: number;
  /** Null without an audio track (the platform-sound path writes none). */
  readonly integratedLufs: number | null;
  readonly truePeakDbtp: number | null;
}

/** The exported file's properties, as ffprobe and an EBU R128 pass read them. */
export async function exportedFile(binaries: ResolvedFfmpeg, path: string): Promise<ExportedFile> {
  const { stdout } = await run(binaries.ffprobe, [
    ...['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path],
  ]);
  const probe = JSON.parse(stdout) as {
    streams: {
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
    }[];
    format: { duration: string };
  };
  const video = probe.streams.find((s) => s.codec_type === 'video');
  const audio = probe.streams.find((s) => s.codec_type === 'audio');
  const [num, den] = (video?.avg_frame_rate ?? '0/1').split('/').map(Number);
  const loudness = audio ? unwrap(await measureLoudness(path, { binaries })) : null;
  return {
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: den ? num! / den : 0,
    videoCodec: video?.codec_name ?? 'none',
    audioCodec: audio?.codec_name ?? null,
    seconds: Number(probe.format.duration),
    integratedLufs: loudness?.integratedLufs ?? null,
    truePeakDbtp: loudness?.truePeakDbtp ?? null,
  };
}

/** `pid` and every process under it. */
function processTree(pid: number): number[] {
  const table = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((pair) => pair.length === 2 && pair.every(Number.isFinite));
  const tree = [pid];
  for (let i = 0; i < tree.length; i++)
    for (const [child, parent] of table) if (parent === tree[i] && !tree.includes(child!)) tree.push(child!);
  return tree;
}

const LOCAL = /^(127\.|\[?::1\]?|localhost|\*|\[?fe80|224\.0\.0\.251|\[?ff02)/;

/**
 * Connections off this Mac from the app's processes (main, its utility
 * processes, the renderer, FFmpeg and the headless shell they start), sampled
 * with lsof: the network test. Loopback and mDNS don't count.
 */
export function networkWatch(rootPid: number, everyMs = 500) {
  const seen = new Set<string>();
  const sample = () => {
    const pids = processTree(rootPid).join(',');
    let out: string;
    try {
      out = execFileSync('/usr/sbin/lsof', ['-nP', '-iTCP', '-iUDP', '-a', '-p', pids], { encoding: 'utf8' });
    } catch {
      return; // lsof exits 1 when nothing matches
    }
    for (const line of out.split('\n').slice(1)) {
      const name = line.trim().split(/\s+/).slice(8).join(' ');
      const remote = name.includes('->') ? name.split('->')[1]!.split(' ')[0]! : '';
      if (remote && !LOCAL.test(remote)) seen.add(`${line.split(/\s+/)[0]} ${remote}`);
    }
  };
  const timer = setInterval(sample, everyMs);
  return {
    /** Remote endpoints seen so far, with the command that had them. */
    offMac: (): string[] => (sample(), [...seen]),
    stop: () => clearInterval(timer),
  };
}
