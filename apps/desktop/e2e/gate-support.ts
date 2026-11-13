// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the gate test (gate.e2e.ts) needs around the app: the video it asks
 * about, a launch that times each start-up step, the library database read
 * over a second, read-only connection for the backing checks (the real
 * renderer exposes no client to the test), and an app client in the page for
 * calls the UI has no control for yet.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ElectronApplication, Page } from '@playwright/test';
import { TERMINAL_JOB_STATES, unwrap, type RunId } from '@taalcut/core';
import { detectEncoders, runFfmpeg, type ResolvedFfmpeg } from '@taalcut/media';
import { libraryPath } from '../src/shared/library-path';
import { desktopDir, launchElectron } from './launch';

/** A 2-second test-pattern video, made with the FFmpeg the app itself uses. */
export async function makeVideo(binaries: ResolvedFfmpeg, path: string): Promise<void> {
  const ctx = { binaries };
  const encoders = unwrap(await detectEncoders(ctx));
  const codec =
    ['libx264', 'libopenh264', 'h264_videotoolbox', 'mpeg4'].find((name) =>
      encoders.encoders.some((e) => e.name === name),
    ) ?? 'mpeg4';
  unwrap(
    await runFfmpeg(ctx, [
      ...['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '2'],
      ...['-c:v', codec, '-pix_fmt', 'yuv420p', path],
    ]),
  );
}

/**
 * Times each start-up step against its own limit, so a stall fails with which
 * step it was and how long the ones before took, instead of a bare hook
 * timeout.
 */
export class StartupTimeline {
  private readonly startedAt = Date.now();
  private readonly marks: string[] = [];
  private readonly output: string[] = [];

  /** The app's stdout and stderr, last lines first in a failure. */
  listen(app: ElectronApplication): void {
    const keep = (chunk: Buffer) => {
      this.output.push(...String(chunk).split('\n').filter(Boolean));
      this.output.splice(0, Math.max(0, this.output.length - 30));
    };
    app.process().stdout?.on('data', keep);
    app.process().stderr?.on('data', keep);
  }

  async step<T>(name: string, limitMs: number, work: () => Promise<T>): Promise<T> {
    const from = Date.now();
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${name}: not done after ${limitMs} ms`)), limitMs);
    });
    try {
      const value = await Promise.race([work(), late]);
      this.marks.push(`${name} ${Date.now() - from} ms (at ${Date.now() - this.startedAt} ms)`);
      return value;
    } catch (cause) {
      throw new Error(this.report(cause instanceof Error ? cause.message : String(cause)), { cause });
    } finally {
      clearTimeout(timer);
    }
  }

  private report(problem: string): string {
    const [load] = loadavg();
    return [
      `Start-up stalled. ${problem}.`,
      `Steps done: ${this.marks.join('; ') || 'none'}.`,
      `Load ${load?.toFixed(1)} on ${availableParallelism()} cores.`,
      `App output (last lines):\n${this.output.join('\n') || '(none)'}`,
    ].join('\n');
  }
}

/** Launches the unpackaged build (out/) with its own userData and the given environment. */
export function launchApp(userData: string, env: Readonly<Record<string, string>>) {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== 'TAALCUT_RENDERER_URL',
    ),
  );
  return launchElectron(userData, { env: { ...inherited, ...env }, timeout: 0 });
}

export interface CloudCallRow {
  readonly module: string;
  readonly provider: string;
  readonly outcome: string;
  readonly local: number;
}

export interface JobRow {
  readonly kind: string;
  readonly state: string;
  readonly error: string | null;
}

/** The app's library database, read while it runs. */
export function libraryReader(userData: string) {
  const read = <T>(sql: string, ...params: (string | number)[]): T[] => {
    const db = new DatabaseSync(libraryPath(userData), { readOnly: true });
    try {
      return db.prepare(sql).all(...params) as T[];
    } finally {
      db.close();
    }
  };
  return {
    sourceRoots: () =>
      read<{ root_path: string }>('SELECT root_path FROM sources ORDER BY created_at').map(
        (r) => r.root_path,
      ),
    jobs: () => read<JobRow>('SELECT kind, state, error FROM jobs ORDER BY created_at'),
    /** The newest run for this request. */
    runFor: (message: string) =>
      read<{ run_id: RunId }>(
        'SELECT run_id FROM trace_runs WHERE message = ? ORDER BY started_at DESC LIMIT 1',
        message,
      )[0]?.run_id,
    cloudCalls: (runId: RunId) =>
      read<CloudCallRow>(
        'SELECT module, provider, outcome, local FROM cloud_calls WHERE run_id = ? ORDER BY started_at',
        runId,
      ),
    spans: (runId: RunId) =>
      read<{ span_id: string; kind: string; name: string }>(
        'SELECT span_id, kind, name FROM trace_spans WHERE run_id = ? ORDER BY started_at',
        runId,
      ),
    /** Standing upload consents ("Always allow"), by cloud module, as Settings keeps them. */
    uploadConsents: (): unknown => {
      const [row] = read<{ value: string }>("SELECT value FROM settings WHERE key = 'agent.uploadConsents'");
      return row ? (JSON.parse(row.value) as unknown) : undefined;
    },
  };
}

/** Jobs not yet finished, as `kind:state`: background work (indexing a new folder) that a check waits out first. */
export function unsettledJobs(rows: readonly JobRow[]): string[] {
  return rows
    .filter((row) => !TERMINAL_JOB_STATES.some((state) => state === row.state))
    .map((row) => `${row.kind}:${row.state}`);
}

/** Failed jobs with their error codes, for failure messages (a tool's error reaches the chat by name only). */
export function failedJobs(rows: readonly JobRow[]): string {
  const failed = rows.filter((row) => row.state === 'failed');
  if (failed.length === 0) return 'no failed jobs';
  return failed
    .map((row) => {
      const error = row.error ? (JSON.parse(row.error) as { code?: string; detail?: string }) : {};
      return `${row.kind} job failed: ${error.code ?? '?'} ${error.detail ?? ''}`.trim();
    })
    .join('; ');
}

/**
 * Leaves an app client on window.taalcutProbe in the page, connected the way
 * the renderer connects (core's connectToMain, through the preload's bridge):
 * the placeholder renderer's probe script, bundled for the browser and run as
 * a DevTools evaluate (the page's CSP governs the page's own scripts, not
 * this). For calls the UI has no control for yet, e.g. consents.revoke until
 * Settings has one. Main keeps one connection per page, so this one replaces
 * the renderer's: reload the page when done.
 */
export async function installAppClient(page: Page): Promise<void> {
  const { build } = await import('tsdown');
  const outDir = mkdtempSync(join(tmpdir(), 'taalcut-e2e-probe-'));
  try {
    await build({
      config: false,
      entry: { probe: join(desktopDir, 'src', 'placeholder', 'probe.ts') },
      outDir,
      platform: 'browser',
      format: 'iife',
      dts: false,
      sourcemap: false,
      report: false,
      logLevel: 'silent',
      deps: { alwaysBundle: [/./] },
    });
    const script = readdirSync(outDir).find((name) => name.startsWith('probe') && name.endsWith('.js'));
    if (!script) throw new Error(`no probe bundle in ${outDir}: ${readdirSync(outDir).join(', ')}`);
    await page.evaluate(readFileSync(join(outDir, script), 'utf8'));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

export type { Page };

/** The heading of the card that asks before something leaves the computer, in the words this platform shows (UX3). */
export const SEND_OFF_HEADING =
  process.platform === 'darwin' ? 'Send this off your Mac?' : 'Send this off your computer?';
