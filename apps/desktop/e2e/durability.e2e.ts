// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Gate criterion 5: "Killing the app mid-job and mid-agent-run, then
 * reopening, resumes both with no lost commands." On the unpackaged test
 * build, with one user-data directory throughout:
 *
 * - kill -9 main while a media.extractFrame job runs (its FFmpeg child held
 *   with SIGSTOP, so the kill lands mid-job) and commands stream in. Old main,
 *   agent and jobs are all gone; the relaunch's recovery report lists the
 *   reclaimed job and the last saved commands; the job completes; every
 *   acknowledged command is in the audit log once, with no sequence gaps;
 *   re-sending the unacknowledged ones with their idempotency keys applies
 *   each exactly once.
 * - kill -9 the agent (it owns the command bus) mid-burst: the call in
 *   flight fails with core.process_restarted; the same audit-log checks.
 * - kill -9 the jobs process mid-job: it is restarted, takes the dead
 *   process's lease over at once and the job completes on the same attempt.
 *
 * The job halves need an FFmpeg build (tools/ffmpeg/dist or
 * TAALCUT_FFMPEG_DIR); without one they are skipped and say so. The
 * agent-run half is durability-runs.e2e.ts.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { JobId } from '@taalcut/core';
import {
  alive,
  appWideCommands,
  childrenOf,
  enqueueFrameJob,
  ffmpegDir,
  launchApp,
  makeClip,
  utilityPid as pidOf,
  type AuditRow,
} from './durability-helpers';

const ffmpeg = ffmpegDir();
const NO_FFMPEG = 'no FFmpeg build (tools/ffmpeg/dist or TAALCUT_FFMPEG_DIR), so no media job ran';
const CLIP_SECONDS = 20;

interface Ack {
  readonly key: string;
  readonly id: string;
  readonly sequence: number | null;
  readonly deduplicated: boolean;
}
interface Burst {
  readonly acks: Ack[];
  error: string | null;
  done: boolean;
}

let app: ElectronApplication;
let page: Page;
let userData = '';
let work = '';
let clip = '';
/** FFmpeg children frozen with SIGSTOP; orphans once their jobs process dies. Killed at the end. */
const frozen: number[] = [];

test.describe.configure({ mode: 'serial' });

async function launch(): Promise<void> {
  ({ app, page } = await launchApp(userData, ffmpeg ? { TAALCUT_FFMPEG_DIR: ffmpeg } : {}));
}

const utilityPid = (name: 'agent' | 'jobs') => pidOf(app, name);

/** settings.setTheme, keys `<prefix>-0`, `-1`, … one after another, until a dispatch fails. */
function preference(key: string): 'dark' | 'light' {
  return Number(key.slice(key.lastIndexOf('-') + 1)) % 2 === 0 ? 'dark' : 'light';
}

async function startBurst(prefix: string): Promise<void> {
  await page.evaluate(async (keyPrefix) => {
    const rpc = await window.taalcutProbe?.client;
    if (!rpc) throw new Error('no client');
    const state: Burst = { acks: [], error: null, done: false };
    (window as unknown as { __burst: Burst }).__burst = state;
    void (async () => {
      for (let i = 0; i < 5000; i++) {
        const key = `${keyPrefix}-${i}`;
        try {
          const receipt = await rpc.commands.dispatch({
            name: 'settings.setTheme',
            payload: { preference: i % 2 === 0 ? 'dark' : 'light' },
            source: 'ui',
            idempotencyKey: key,
          });
          state.acks.push({
            key,
            id: receipt.id,
            sequence: receipt.sequence,
            deduplicated: receipt.deduplicated,
          });
        } catch (error) {
          state.error = (error as { data?: { code?: string } }).data?.code ?? String(error);
          break;
        }
      }
      state.done = true;
    })();
  }, prefix);
}

function burst(): Promise<Burst> {
  return page.evaluate(() => structuredClone((window as unknown as { __burst: Burst }).__burst));
}

/** Dispatches these keys again (same payloads), in order. */
function resend(keys: readonly string[]): Promise<Ack[]> {
  const calls = keys.map((key) => ({ key, preference: preference(key) }));
  return page.evaluate(async (list) => {
    const rpc = await window.taalcutProbe?.client;
    if (!rpc) throw new Error('no client');
    const acks: Ack[] = [];
    for (const { key, preference: value } of list) {
      const receipt = await rpc.commands.dispatch({
        name: 'settings.setTheme',
        payload: { preference: value },
        source: 'ui',
        idempotencyKey: key,
      });
      acks.push({ key, id: receipt.id, sequence: receipt.sequence, deduplicated: receipt.deduplicated });
    }
    return acks;
  }, calls);
}

/**
 * The audit log after a crash: no gaps in the app-wide sequence; this
 * burst's keys form an unbroken run from 0 (applied in order, none skipped);
 * every acknowledged command is there with its receipt's id and sequence.
 */
function checkAuditLog(prefix: string, acks: readonly Ack[]): AuditRow[] {
  const rows = appWideCommands(userData);
  expect(rows.map((row) => row.seq)).toEqual(rows.map((_, index) => index + 1));
  const ours = rows.filter((row) => row.key?.startsWith(`${prefix}-`));
  expect(ours.map((row) => row.key)).toEqual(ours.map((_, index) => `${prefix}-${index}`));
  for (const ack of acks) {
    expect(ours.find((row) => row.key === ack.key)).toMatchObject({
      id: ack.id,
      seq: ack.sequence,
      name: 'settings.setTheme',
      source: 'ui',
      actor: 'user',
    });
  }
  return ours;
}

/** The burst's unacknowledged keys, re-sent: the committed ones come back deduplicated, the rest apply once. */
async function resendUnacknowledged(prefix: string, acks: readonly Ack[], committed: number): Promise<void> {
  // Sequential dispatch: at most the key after the last committed one was in flight.
  const keys = Array.from({ length: committed - acks.length + 1 }, (_, i) => `${prefix}-${acks.length + i}`);
  const again = await resend(keys);
  expect(again.map((ack) => ack.deduplicated)).toEqual(keys.map((_, i) => acks.length + i < committed));
  const all = [...acks, ...again];
  expect(checkAuditLog(prefix, all)).toHaveLength(committed + 1);
  test.info().annotations.push({
    type: 'audit log',
    description:
      `${prefix}: ${acks.length} acknowledged before the kill, ${committed} committed, ` +
      `${keys.length} re-sent (${committed - acks.length} deduplicated), ${committed + 1} applied once each`,
  });
}

function jobState(id: JobId): Promise<{ state: string; attempt: number; output?: unknown } | string> {
  return page.evaluate(async (jobId) => {
    const rpc = await window.taalcutProbe?.client;
    return rpc!.jobs.get({ id: jobId }).then(
      ({ state, attempt, output }) => ({ state, attempt, output }),
      (error: { data?: { code?: string } }) => error.data?.code ?? String(error),
    );
  }, id);
}

/** Waits for the jobs process to start FFmpeg on the clip, then freezes it: the job is held mid-run. */
async function holdJobMidRun(id: JobId): Promise<void> {
  const jobs = (await utilityPid('jobs')) as number;
  // The decode (ffmpeg, seconds on this clip), not the probe before it (ffprobe, milliseconds).
  const freeze = (): boolean => {
    const child = childrenOf(jobs, clip).find((process) => /\/ffmpeg\s/.test(process.command));
    if (!child) return false;
    try {
      process.kill(child.pid, 'SIGSTOP');
    } catch {
      return false; // It finished between ps and kill.
    }
    frozen.push(child.pid);
    return true;
  };
  await expect.poll(freeze, { timeout: 15_000, intervals: [20] }).toBe(true);
  expect(await jobState(id)).toMatchObject({ state: 'running', attempt: 1 });
}

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'taalcut-e2e-durability-'));
  work = mkdtempSync(join(tmpdir(), 'taalcut-e2e-durability-media-'));
  clip = join(work, 'one-keyframe.mp4');
  if (ffmpeg) makeClip(join(ffmpeg, 'ffmpeg'), clip, CLIP_SECONDS);
  await launch();
});

test.afterAll(async () => {
  for (const pid of frozen) if (alive(pid)) process.kill(pid, 'SIGKILL');
  await app?.close().catch(() => undefined);
  rmSync(userData, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

test('kill -9 main mid-job and mid-commands: the relaunch reports and finishes the job, and loses no command', async () => {
  test.setTimeout(180_000);
  await startBurst('main');
  await expect.poll(async () => (await burst()).acks.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(20);
  const job = ffmpeg ? enqueueFrameJob(userData, clip, CLIP_SECONDS - 1) : undefined;
  if (job) await holdJobMidRun(job);
  else test.info().annotations.push({ type: 'skipped part', description: NO_FFMPEG });

  // What the test knows was acknowledged; anything acknowledged after this read counts as unacknowledged.
  const { acks } = await burst();
  const old = [app.process().pid, await utilityPid('agent'), await utilityPid('jobs')];
  process.kill(old[0] as number, 'SIGKILL');
  // Nothing of the old app keeps running, so nothing else holds the job or writes the log.
  await expect
    .poll(() => old.filter((pid) => pid !== undefined && alive(pid)), { timeout: 10_000 })
    .toEqual([]);

  await launch();
  const rows = appWideCommands(userData);
  const report = await page.evaluate(async () => (await window.taalcutProbe?.client)?.recovery.report());
  expect(report).toMatchObject({ restoredFromBackup: null, unfinishedRuns: [] });
  // The prompt's "last saved changes": the newest app-wide commands, oldest first, ending with the last one.
  const lastSaved = report?.lastCommands.find((scope) => scope.projectId === null)?.commands ?? [];
  expect(lastSaved.map((command) => command.id)).toEqual(rows.slice(-3).map((row) => row.id));
  expect(lastSaved.at(-1)).toMatchObject({ name: 'settings.setTheme', source: 'ui', undone: false });

  if (job) {
    expect(report?.reclaimedJobs).toContainEqual(
      expect.objectContaining({ id: job, kind: 'media.extractFrame', state: 'queued' }),
    );
    expect(report?.needsAttention).toBe(true);
    // Main's app-start reclaim counts the quit as a free restart, like the jobs engine's takeover:
    // the attempt is given back, so a one-attempt job survives a quit (P2-L13, P2-T3).
    await expect
      .poll(() => jobState(job), { timeout: 60_000, intervals: [250] })
      .toMatchObject({
        state: 'succeeded',
        attempt: 1,
        output: expect.objectContaining({ mimeType: 'image/jpeg' }),
      });
  }

  const committed = checkAuditLog('main', acks);
  expect(committed.length).toBeGreaterThanOrEqual(acks.length);
  await resendUnacknowledged('main', acks, committed.length);
});

test('kill -9 the agent mid-commands: the call in flight fails, nothing acknowledged is lost', async () => {
  await startBurst('agent');
  await expect.poll(async () => (await burst()).acks.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(20);
  const agent = (await utilityPid('agent')) as number;
  process.kill(agent, 'SIGKILL');
  await expect.poll(async () => (await burst()).done, { timeout: 10_000 }).toBe(true);
  const { acks, error } = await burst();
  expect(error).toBe('core.process_restarted');

  // Back within 2 s (the supervisor), answering again.
  await expect
    .poll(
      () =>
        page.evaluate(async () =>
          (await window.taalcutProbe?.client)?.diagnostics.agent.ping().then(
            (pong) => pong.pid,
            () => undefined,
          ),
        ),
      { timeout: 5_000, intervals: [50] },
    )
    .not.toBe(undefined);
  expect(await utilityPid('agent')).not.toBe(agent);

  const committed = checkAuditLog('agent', acks);
  // The dispatch in flight either committed before the kill or never did.
  expect(committed.length - acks.length).toBeGreaterThanOrEqual(0);
  expect(committed.length - acks.length).toBeLessThanOrEqual(1);
  await resendUnacknowledged('agent', acks, committed.length);
});

test('kill -9 the jobs process mid-job: it comes back and the job completes', async () => {
  test.skip(!ffmpeg, NO_FFMPEG);
  test.setTimeout(180_000);
  const job = enqueueFrameJob(userData, clip, CLIP_SECONDS - 2);
  await holdJobMidRun(job);
  const jobs = (await utilityPid('jobs')) as number;
  process.kill(jobs, 'SIGKILL');
  await expect
    .poll(async () => (await utilityPid('jobs')) ?? jobs, { timeout: 5_000, intervals: [50] })
    .not.toBe(jobs);
  // The new engine takes over the dead process's lease when it starts, not when the lease (30 s)
  // runs out: FFmpeg is on the clip again within seconds, and the restart doesn't spend the attempt.
  const restarted = (await utilityPid('jobs')) as number;
  const resumed = async () => {
    if (childrenOf(restarted, clip).some((child) => /\/ffmpeg\s/.test(child.command))) return true;
    const now = await jobState(job);
    return typeof now === 'object' && now.state === 'succeeded';
  };
  await expect.poll(resumed, { timeout: 10_000, intervals: [50] }).toBe(true);
  await expect
    .poll(() => jobState(job), { timeout: 60_000, intervals: [250] })
    .toMatchObject({ state: 'succeeded', attempt: 1 });
});
