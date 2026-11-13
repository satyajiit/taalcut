// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Done when: a child process is killed (kill -9) mid-job and the job resumes.
 *
 * The child runs a stepped job over a store persisted to a JSON file, holds
 * after a few steps, and is SIGKILLed once those are saved. This process then
 * opens the same file with a clock past the dead child's lease, reclaims the
 * job and finishes it from the last saved step. (The file-backed
 * MemoryJobStore stands in for @taalcut/library's SQLite JobStore, which
 * packages/jobs may not import.)
 *
 * Nothing here depends on how fast the machine is: the child stops at a known
 * step and keeps a lease far longer than the test, the kill waits for the
 * saved step on disk, and recovery uses the store's clock, not a wait.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, unwrap, type JobId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createEngineJobRunner, createJobEngine, fromJobKind } from '../../src/index';
import { fakeIsRunning, probeHandler, probeKind, release, writeFakeFfprobe } from '../fixtures/probe-job';
import { fileBackedStore, LONG_LEASE_MS, STEP_JOB_KIND, stepJob } from '../fixtures/step-job';
import { testEngine, waitFor } from './helpers';

const CHILD = fileURLToPath(new URL('../fixtures/engine-child.ts', import.meta.url));
const PROBE_CHILD = fileURLToPath(new URL('../fixtures/probe-child.ts', import.meta.url));
const CRASH_CHILD = fileURLToPath(new URL('../fixtures/crash-child.ts', import.meta.url));
/** How long to wait for state a busy machine is slow to reach. Waits end as soon as the state is there. */
const PATIENCE = 60_000;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));
const STEPS = 30;

/** Runs the child until it has saved `killAtStep` steps to disk (where it holds), then SIGKILLs it. */
async function runChildAndKill(storePath: string, killAtStep: number) {
  const child = spawn(process.execPath, ['--import', 'tsx', CHILD, storePath, String(killAtStep)], {
    cwd: PACKAGE_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const steps: number[] = [];
  let pending = '';
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop()!;
    for (const line of lines) {
      const [word, n] = line.split(' ');
      if (word === 'step') steps.push(Number(n));
      if (word === 'saved' && Number(n) >= killAtStep) child.kill('SIGKILL');
    }
  });
  const [code, signal] = await new Promise<[number | null, string | null]>((resolve) =>
    child.on('close', (c, s) => resolve([c, s])),
  );
  if (signal !== 'SIGKILL') throw new Error(`child exited with ${code}: ${stderr}`);
  return { steps, signal };
}

/**
 * One boot of the jobs process (crash-child): waits until it has taken over and either the job is failed
 * (then stops it) or the job's handler is running (then SIGKILLs it, as a crashing job would).
 */
async function bootUntilRunning(storePath: string, id: JobId) {
  const child = spawn(process.execPath, ['--import', 'tsx', CRASH_CHILD, storePath], {
    cwd: PACKAGE_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  let pending = '';
  let ready = false;
  let attempt: number | null = null;
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop()!;
    for (const line of lines) {
      if (line === 'ready') ready = true;
      if (line.startsWith('running ')) attempt = Number(line.slice('running '.length));
    }
  });
  const closed = new Promise<void>((resolve) => child.on('close', () => resolve()));
  const failed = () => unwrap(fileBackedStore(storePath).get(id)).state === 'failed';
  await waitFor(() => attempt !== null || (ready && failed()) || child.exitCode !== null, PATIENCE, 'a boot');
  if (child.exitCode !== null) throw new Error(`crash child exited early: ${stderr}`);
  const outcome = { attempt, failed: attempt === null && failed() };
  child.kill('SIGKILL');
  await closed;
  return outcome;
}

describe('job engine: crash recovery', () => {
  it('resumes a job after the process running it is killed with SIGKILL', { timeout: 120_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-jobs-'));
    const path = join(dir, 'jobs.json');
    try {
      const { id } = unwrap(
        fileBackedStore(path).enqueue({
          kind: STEP_JOB_KIND,
          payload: { steps: STEPS },
          resourceClass: 'cpu',
        }),
      ).job;
      const child = await runChildAndKill(path, 5);
      expect(child.signal).toBe('SIGKILL');
      expect(child.steps.length).toBeLessThan(STEPS); // killed mid-job

      // What the dead process left on disk: still running, under its lease, with saved progress.
      // This process reads it as if the lease had run out: no waiting on wall time.
      const store = fileBackedStore(path, undefined, () => Date.now() + 2 * LONG_LEASE_MS);
      const orphaned = unwrap(store.get(id));
      expect(orphaned).toMatchObject({ state: 'running', attempts: 1 });
      expect(orphaned.leaseOwner).toMatch(/^child:/);
      const saved = (orphaned.progressDetail as { step: number }).step;
      expect(saved).toBe(5);

      const resumed: number[] = [];
      const { engine, ofType } = testEngine({ store, bootId: 'parent', leaseMs: LONG_LEASE_MS });
      engine.register(stepJob((step) => resumed.push(step), 5));
      await engine.start();
      await waitFor(() => unwrap(store.get(id)).state === 'succeeded', 60_000, 'the resumed job');

      expect(unwrap(store.get(id))).toMatchObject({
        attempts: 2,
        result: { steps: STEPS, resumedAfter: saved },
      });
      expect(ofType('job.recovered').map((e) => e.job.id)).toEqual([id]);
      expect(resumed[0]).toBe(saved + 1);
      expect(resumed.at(-1)).toBe(STEPS);
      expect(new Set([...child.steps, ...resumed]).size).toBe(STEPS); // every step done, none skipped
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it(
    "an exclusive engine (the restarted jobs process) resumes it at once, the dead child's lease still live",
    { timeout: 120_000 },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'taalcut-jobs-takeover-'));
      const path = join(dir, 'jobs.json');
      try {
        const { id } = unwrap(
          fileBackedStore(path).enqueue({
            kind: STEP_JOB_KIND,
            payload: { steps: STEPS },
            resourceClass: 'cpu',
          }),
        ).job;
        await runChildAndKill(path, 5);

        // Wall-clock time: the dead child's lease has minutes left.
        const store = fileBackedStore(path);
        const orphaned = unwrap(store.get(id));
        expect(orphaned).toMatchObject({ state: 'running', attempts: 1 });
        expect(orphaned.leaseExpiresAt).toBeGreaterThan(Date.now() + LONG_LEASE_MS / 2);

        const resumed: number[] = [];
        const { engine, ofType } = testEngine({
          store,
          exclusive: true,
          log: () => undefined,
          leaseMs: LONG_LEASE_MS,
        });
        engine.register(stepJob((step) => resumed.push(step), 5));
        await engine.start();
        await waitFor(() => unwrap(store.get(id)).state === 'succeeded', 60_000, 'the taken-over job');

        // The restart didn't spend the attempt, and the job went on from its last saved step.
        expect(unwrap(store.get(id))).toMatchObject({
          attempts: 1,
          result: { steps: STEPS, resumedAfter: 5 },
        });
        expect(ofType('job.recovered')[0]?.takeover).toMatchObject({ restarts: 1, attemptCounted: false });
        expect(resumed[0]).toBe(6);
        expect(unwrap(store.get(id)).interruptions).toBe(1); // kept in the store, no side file
        expect(readdirSync(dir).sort()).toEqual(['jobs.json']);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it(
    'ends a crash loop across real restarts: 2 free interruptions, then counted attempts, then the job fails',
    { timeout: 240_000 },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'taalcut-jobs-crashloop-'));
      const path = join(dir, 'jobs.json');
      try {
        const { id } = unwrap(
          fileBackedStore(path).enqueue({
            kind: 'test.crash',
            payload: {},
            resourceClass: 'cpu',
            maxAttempts: 2,
          }),
        ).job;
        const boots: { attempt: number | null; failed: boolean }[] = [];
        for (let boot = 1; boot <= 8; boot++) {
          // A new process each boot: it reopens the store file the dead one left behind.
          const outcome = await bootUntilRunning(path, id);
          boots.push(outcome);
          if (outcome.failed) break;
        }
        // Boot 1 claims; boots 2-3 are free restarts; boot 4 spends attempt 2; boot 5 finds it out of attempts.
        expect(boots).toEqual([
          { attempt: 1, failed: false },
          { attempt: 1, failed: false },
          { attempt: 1, failed: false },
          { attempt: 2, failed: false },
          { attempt: null, failed: true },
        ]);
        expect(unwrap(fileBackedStore(path).get(id))).toMatchObject({
          state: 'failed',
          attempts: 2,
          interruptions: 4,
          error: { code: 'core.process_restarted' },
        });
        expect(readdirSync(dir).sort()).toEqual(['jobs.json']); // no side file for the count
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it(
    'resumes an in-flight probe (a core job kind, via fromJobKind) after kill -9; a runner asking again joins it',
    { timeout: 120_000 },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'taalcut-jobs-probe-'));
      const path = join(dir, 'jobs.json');
      const fake = writeFakeFfprobe(dir);
      const clip = '/Volumes/Trip/IMG_0420.MOV';
      try {
        // Enqueued through the engine API, so the kind's idempotency key and attempts apply.
        const enqueuer = createJobEngine({ store: fileBackedStore(path) });
        const { job } = unwrap(
          await enqueuer.enqueue(fromJobKind(probeKind, probeHandler(fake)), { path: clip }),
        );

        const child = spawn(process.execPath, ['--import', 'tsx', PROBE_CHILD, path, dir], {
          cwd: PACKAGE_DIR,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
        const closed = new Promise<string | null>((resolve) =>
          child.on('close', (_code, signal) => resolve(signal)),
        );
        // In flight: the child's handler has started ffprobe, which waits for a release that hasn't come.
        await waitFor(() => fakeIsRunning(fake) || child.exitCode !== null, PATIENCE, 'the probe to start');
        if (!fakeIsRunning(fake)) throw new Error(`child exited early: ${stderr}`);
        const ffprobe = Number(readFileSync(fake.pidfile, 'utf8'));
        child.kill('SIGKILL');
        expect(await closed).toBe('SIGKILL');

        // Read the file as if the dead child's lease had run out.
        const store = fileBackedStore(path, undefined, () => Date.now() + 2 * LONG_LEASE_MS);
        const orphaned = unwrap(store.get(job.id));
        expect(orphaned).toMatchObject({ state: 'running', attempts: 1, maxAttempts: 2 });
        expect(orphaned.leaseOwner).toMatch(/^child:/);
        // The dead worker's ffprobe is still waiting; releasing it lets it (and the rerun) finish.
        release(fake);
        await waitFor(() => !alive(ffprobe), PATIENCE, "the dead worker's ffprobe to exit");

        const { engine, ofType } = testEngine({ store, bootId: 'parent', leaseMs: LONG_LEASE_MS });
        engine.register(fromJobKind(probeKind, probeHandler(fake)));
        await engine.start();
        // Same input, same idempotency key: the runner waits on the recovered job instead of adding one.
        const result = await createEngineJobRunner(engine).run(probeKind, { path: clip });

        expect(result).toEqual(ok({ path: clip, durationSeconds: 2.002 }));
        expect(store.snapshot()).toHaveLength(1);
        expect(unwrap(store.get(job.id))).toMatchObject({ state: 'succeeded', attempts: 2 });
        expect(ofType('job.recovered').map((e) => e.job.id)).toEqual([job.id]);
      } finally {
        release(fake);
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
