// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Experiments: open, use, list, read, discard, sweep; and job mode, which never starts a child itself. */
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createDirectJobRunner,
  createManualClock,
  ok,
  type ExperimentSandbox,
  type SandboxRunRequest,
} from '@taalcut/core';
import { createExperimentSandbox, createSandboxJobs, DEFAULT_EXPERIMENT_TTL_MS } from '@taalcut/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { experimentId, tempRoot } from './helpers/sandbox';

let temp: { root: string; cleanup: () => void };
let root: string;
beforeEach(() => {
  temp = tempRoot();
  root = join(temp.root, 'scratch');
});
afterEach(() => temp.cleanup());

function sandboxWithClock() {
  const clock = createManualClock(5_000);
  const sandbox = createExperimentSandbox({
    root,
    clock,
    programs: { ffmpeg: '/bin/echo', ffprobe: '/bin/echo' },
  });
  return { sandbox, clock };
}

describe('experiment lifecycle', () => {
  it('open writes experiment.json and a tmp folder; get returns it; open again is the same experiment', async () => {
    const { sandbox, clock } = sandboxWithClock();
    const id = experimentId();
    const opened = await sandbox.open({ id, projectId: null, purpose: 'breakdown' });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value).toMatchObject({ id, projectId: null, purpose: 'breakdown', createdAt: 5_000 });
    expect(opened.value.expiresAt).toBe(5_000 + DEFAULT_EXPERIMENT_TTL_MS);
    expect(opened.value.dir).toBe(join(root, id));
    const manifest = JSON.parse(readFileSync(join(opened.value.dir, 'experiment.json'), 'utf8'));
    expect(manifest).toMatchObject({ version: 1, id, purpose: 'breakdown' });
    expect(existsSync(join(opened.value.dir, 'tmp'))).toBe(true);
    clock.advance(1000);
    const again = await sandbox.open({ id, projectId: null, purpose: 'breakdown' });
    expect(again.ok && again.value.createdAt).toBe(5_000);
    expect(again.ok && again.value.expiresAt).toBe(6_000 + DEFAULT_EXPERIMENT_TTL_MS);
    const got = await sandbox.get(id);
    expect(got.ok && got.value.id).toBe(id);
  });

  it('use extends the TTL; an expired experiment is gone; a bad id is not found', async () => {
    const { sandbox, clock } = sandboxWithClock();
    const id = experimentId();
    await sandbox.open({ id, projectId: null, purpose: 'analysis', ttlMs: 1000 });
    clock.advance(900);
    await sandbox.list(id);
    clock.advance(900);
    expect((await sandbox.get(id)).ok).toBe(true);
    clock.advance(1001);
    const gone = await sandbox.get(id);
    expect(!gone.ok && gone.error.code).toBe('sandbox.experiment_not_found');
    const reopened = await sandbox.open({ id, projectId: null, purpose: 'analysis' });
    expect(reopened.ok && reopened.value.createdAt).toBe(clock.now());
    const bad = await sandbox.get('../../etc' as never);
    expect(!bad.ok && bad.error.code).toBe('sandbox.experiment_not_found');
    const badOpen = await sandbox.open({ id: 'nope' as never, projectId: null, purpose: 'analysis' });
    expect(!badOpen.ok && badOpen.error.code).toBe('sandbox.experiment_not_found');
  });

  it('lists files and folders, hides the manifest and tmp, and reads text inside only', async () => {
    const { sandbox } = sandboxWithClock();
    const id = experimentId();
    const opened = await sandbox.open({ id, projectId: null, purpose: 'analysis' });
    if (!opened.ok) throw new Error('open failed');
    const dir = opened.value.dir;
    mkdirSync(join(dir, 'frames'));
    writeFileSync(join(dir, 'frames', 'a.jpg'), 'abc');
    writeFileSync(join(dir, 'scores.txt'), 'é'.repeat(10));
    writeFileSync(join(dir, 'tmp', 'x'), 'hidden');
    writeFileSync(join(temp.root, 'secret.txt'), 'secret');
    symlinkSync(join(temp.root, 'secret.txt'), join(dir, 'link.txt'));
    const listed = await sandbox.list(id);
    expect(listed.ok && listed.value).toEqual([
      { path: 'frames', bytes: 0, kind: 'directory' },
      { path: 'frames/a.jpg', bytes: 3, kind: 'file' },
      { path: 'scores.txt', bytes: 20, kind: 'file' },
    ]);
    const sub = await sandbox.list(id, 'scratch:frames/');
    expect(sub.ok && sub.value.map((file) => file.path)).toEqual(['frames/a.jpg']);
    expect((await sandbox.list(id, '../')).ok).toBe(false);
    const text = await sandbox.readText(id, 'scratch:scores.txt');
    expect(text.ok && text.value).toBe('é'.repeat(10));
    const cut = await sandbox.readText(id, 'scores.txt', 5);
    expect(cut.ok && cut.value).toBe('éé');
    const outside = await sandbox.readText(id, 'link.txt');
    expect(!outside.ok && outside.error.code).toBe('sandbox.path_outside');
    expect((await sandbox.readText(id, '../../secret.txt')).ok).toBe(false);
    expect((await sandbox.readText(id, 'experiment.json')).ok).toBe(false);
    const missing = await sandbox.readText(id, 'nope.txt');
    expect(!missing.ok && missing.error.code).toBe('sandbox.path_outside');
  });

  it('discard removes the folder and reports the bytes freed', async () => {
    const { sandbox } = sandboxWithClock();
    const id = experimentId();
    const opened = await sandbox.open({ id, projectId: null, purpose: 'breakdown' });
    if (!opened.ok) throw new Error('open failed');
    writeFileSync(join(opened.value.dir, 'reference.mp4'), Buffer.alloc(1000));
    const discarded = await sandbox.discard(id);
    expect(discarded.ok && discarded.value.freedBytes).toBeGreaterThanOrEqual(1000);
    expect(existsSync(opened.value.dir)).toBe(false);
    const twice = await sandbox.discard(id);
    expect(!twice.ok && twice.error.code).toBe('sandbox.experiment_not_found');
  });

  it('sweep removes expired experiments, manifest-less folders and tampered manifests', async () => {
    const { sandbox, clock } = sandboxWithClock();
    const live = experimentId();
    const expired = experimentId();
    const tampered = experimentId();
    await sandbox.open({ id: live, projectId: null, purpose: 'analysis' });
    await sandbox.open({ id: expired, projectId: null, purpose: 'analysis', ttlMs: 10 });
    const t = await sandbox.open({ id: tampered, projectId: null, purpose: 'analysis' });
    if (!t.ok) throw new Error('open failed');
    const manifestPath = join(t.value.dir, 'experiment.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, expiresAt: clock.now() + 365 * 86_400_000 }));
    const stray = experimentId();
    mkdirSync(join(root, stray));
    mkdirSync(join(root, 'not-an-id'));
    writeFileSync(join(root, 'file.txt'), 'x');
    clock.advance(100);
    const swept = await sandbox.sweep();
    expect(swept.ok && [...swept.value.removed].sort()).toEqual([expired, tampered, stray].sort());
    expect(existsSync(join(root, live))).toBe(true);
    expect(existsSync(join(root, 'not-an-id'))).toBe(false);
    expect(existsSync(join(root, 'file.txt'))).toBe(true);
  });
});

describe('job mode', () => {
  function fakeExec(): { sandbox: ExperimentSandbox; seen: SandboxRunRequest[] } {
    const seen: SandboxRunRequest[] = [];
    const sandbox = createExperimentSandbox({
      root,
      programs: { ffmpeg: '/bin/echo', ffprobe: '/bin/echo' },
    });
    return {
      seen,
      sandbox: {
        ...sandbox,
        run: async (_id, request, options) => {
          seen.push(request);
          options?.onProgress?.({ fraction: 0.5 });
          return ok({
            exitCode: 0,
            stdout: 'ok',
            stderrTail: '',
            durationMs: 1,
            written: [{ path: 'a', bytes: 1 }],
          });
        },
      },
    };
  }

  it('run enqueues sandbox.run, so the child starts in the jobs process', async () => {
    const exec = fakeExec();
    const agent = createExperimentSandbox({
      root,
      jobs: createDirectJobRunner(createSandboxJobs(exec.sandbox)),
    });
    const id = experimentId();
    await agent.open({ id, projectId: null, purpose: 'analysis' });
    const progress: unknown[] = [];
    const result = await agent.run(
      id,
      { program: 'ffprobe', args: ['scratch:x'], network: 'none', limits: { wallMs: 5000 } },
      { onProgress: (p) => progress.push(p) },
    );
    expect(result.ok && result.value.stdout).toBe('ok');
    expect(exec.seen).toEqual([
      { program: 'ffprobe', args: ['scratch:x'], network: 'none', limits: { wallMs: 5000 } },
    ]);
    expect(progress).toEqual([{ fraction: 0.5 }]);
    const listed = await agent.list(id);
    expect(listed.ok).toBe(true);
  });

  it('refuses the fetcher and the network, and limits above the defaults', async () => {
    const exec = fakeExec();
    const agent = createExperimentSandbox({
      root,
      jobs: createDirectJobRunner(createSandboxJobs(exec.sandbox)),
    });
    const id = experimentId();
    const ytDlp = await agent.run(id, { program: 'ytDlp', args: [], network: 'outbound' });
    expect(!ytDlp.ok && ytDlp.error.code).toBe('sandbox.program_not_allowed');
    const online = await agent.run(id, { program: 'ffmpeg', args: [], network: 'outbound' });
    expect(!online.ok && online.error.code).toBe('sandbox.program_not_allowed');
    const long = await agent.run(id, { program: 'ffmpeg', args: [], limits: { wallMs: 10 * 60_000 } });
    expect(!long.ok && long.error.code).toBe('core.validation');
    expect(exec.seen).toEqual([]);
  });
});
