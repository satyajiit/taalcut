// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the durability tests need around the app: launching it, processes
 * (who is alive, a utility process's children), the library database
 * (enqueue a job, read the command audit log), and FFmpeg (find the build,
 * make test clips).
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { unwrap, type JobId } from '@taalcut/core';
import { createJobRepository, JOB_PRIORITY_VALUES, openDatabase } from '@taalcut/library';
import {
  createBinaryResolver,
  detectEncoders,
  ffmpegBuildTarget,
  mediaExtractFrameJob,
  runFfmpeg,
} from '@taalcut/media';
import { softwareH264FixtureFlags } from '@taalcut/media/test-support';
import { libraryPath } from '../src/shared/library-path';
import { desktopDir, launchElectron } from './launch';
import './renderer-probes';

export { utilityPid } from './utility-pids';

const repoRoot = join(desktopDir, '..', '..');

/** Launches the unpackaged build on `userData` and waits for the page's client and the agent. */
export async function launchApp(
  userData: string,
  extraEnv: Record<string, string> = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== 'TAALCUT_RENDERER_URL',
    ),
  );
  const app = await launchElectron(userData, { env: { ...env, ...extraEnv } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // The agent composes after main hands it its port; wait until it answers.
  const deadline = Date.now() + 15_000;
  for (;;) {
    const answer = await page.evaluate(async () => {
      const rpc = await window.taalcutProbe?.client;
      return rpc?.diagnostics.agent.ping().then(
        (pong) => pong.process,
        () => 'not yet',
      );
    });
    if (answer === 'agent') return { app, page };
    if (Date.now() > deadline) throw new Error('the agent process never answered');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Every process whose command line contains `needle`, with its parent. */
export function processesWith(needle: string): { pid: number; ppid: number; command: string }[] {
  const table = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' });
  return table
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .filter((match) => (match[3] ?? '').includes(needle))
    .map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? '' }));
}

/** Direct children of `parent` whose command line contains `needle`. */
export function childrenOf(parent: number, needle: string): { pid: number; command: string }[] {
  return processesWith(needle)
    .filter((found) => found.ppid === parent)
    .map(({ pid, command }) => ({ pid, command }));
}

/**
 * The whisper-servers run from this userData's components, with their parents (IX-F7). A model server must not
 * outlive the jobs process that started it.
 */
export function whisperServersOf(userData: string): { pid: number; ppid: number; command: string }[] {
  return processesWith(join(userData, 'components')).filter((found) =>
    found.command.includes('whisper-server'),
  );
}

/**
 * The FFmpeg build the jobs process should use: TAALCUT_FFMPEG_DIR, or the folder of this platform's build under
 * tools/ffmpeg/dist when there is one (media's build target: dist/ on a Mac, dist/linux-x64/bin on Linux).
 */
export function ffmpegDir(): string | undefined {
  const target = ffmpegBuildTarget();
  const dist = target && join(repoRoot, 'tools', 'ffmpeg', 'dist', target.devFolder, target.binDir);
  const candidates = [process.env.TAALCUT_FFMPEG_DIR?.trim(), dist];
  return candidates.find(
    (dir): dir is string => !!dir && existsSync(join(dir, 'ffmpeg')) && existsSync(join(dir, 'ffprobe')),
  );
}

/**
 * A 1080p clip with one keyframe and heavy noise, so a frame near its end
 * takes a while to decode. VideoToolbox when the machine has it, else NVENC
 * with its scene-cut keyframes off (LNX1-PKG: on an NVIDIA PC; 20 s decode to
 * its end in about a second), else the platform's software H.264 encoder.
 */
export function makeClip(ffmpeg: string, path: string, seconds: number): void {
  const source = ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30,noise=alls=40:allf=t+u'];
  const output = ['-t', String(seconds), '-g', '100000', '-b:v', '20M', '-pix_fmt', 'yuv420p', path];
  const encoders = [
    ['-c:v', 'h264_videotoolbox'],
    ['-c:v', 'h264_nvenc', '-no-scenecut', '1'],
    softwareH264FixtureFlags(),
  ];
  for (const [index, flags] of encoders.entries()) {
    try {
      execFileSync(ffmpeg, ['-hide_banner', '-v', 'error', '-y', ...source, ...flags, ...output], {
        stdio: ['ignore', 'ignore', index === encoders.length - 1 ? 'inherit' : 'ignore'],
      });
      return;
    } catch (error) {
      if (index === encoders.length - 1) throw error;
    }
  }
}

/** The gate demo's 2-second clip, made as gate.e2e.ts makes it: the recorded session expects its probe. */
export async function makeGateVideo(path: string): Promise<void> {
  const ctx = { binaries: unwrap(await createBinaryResolver({ development: true }).resolve()) };
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

/** Enqueues media.extractFrame for a frame `atSeconds` into the clip, as the jobs process would. */
export function enqueueFrameJob(userData: string, clip: string, atSeconds: number): JobId {
  const opened = openDatabase({ path: libraryPath(userData), recovery: { reclaimJobs: 'none' } });
  if (!opened.ok) throw new Error(`library not opened: ${opened.error.code}`);
  try {
    const queued = createJobRepository(opened.value).enqueue({
      kind: mediaExtractFrameJob.kind,
      payload: { path: clip, at: { value: atSeconds, rate: 1 }, format: 'jpeg', maxDimension: 64 },
      // The kind's own settings (packages/media jobs/kinds.ts): the video class since IX-S1, which a job queued
      // as 'gpu' never left (LNX1-PKG: found when Linux first ran this part); high priority; one retry.
      resourceClass: mediaExtractFrameJob.resource,
      priority: JOB_PRIORITY_VALUES[mediaExtractFrameJob.priority],
      maxAttempts: 2,
    });
    if (!queued.ok) throw new Error(`job not enqueued: ${queued.error.code}`);
    return queued.value.job.id;
  } finally {
    opened.value.close();
  }
}

export interface AuditRow {
  readonly id: string;
  readonly seq: number;
  readonly key: string | null;
  readonly name: string;
  readonly source: string;
  readonly actor: string;
  readonly status: string;
}

/** The app-wide (null project) command audit log, in sequence order. A read-only second connection. */
export function appWideCommands(userData: string): AuditRow[] {
  const db = new DatabaseSync(libraryPath(userData), { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT id, seq, idempotency_key AS key, name, source, actor, status
         FROM commands WHERE project_id IS NULL ORDER BY seq`,
      )
      .all() as unknown as AuditRow[];
  } finally {
    db.close();
  }
}
