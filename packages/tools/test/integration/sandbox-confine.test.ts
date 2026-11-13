// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Confinement is macOS's, not the validator's (P2-T2 "Done when"). These runs
 * go straight to the runner with the real profiles, skipping the validator,
 * and show the kernel refusing: writes outside scratch, reads of the home
 * folder, the network, and any other program. Then the real sandbox: an
 * FFmpeg run, VideoToolbox decode, and the fetcher profile with the network on.
 */
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer, type AddressInfo, type Server } from 'node:net';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SANDBOX_LIMITS, ok } from '@taalcut/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultProfilesDir, profileParams, profilePath } from '../../src/sandbox/profiles';
import { runConfined, type ConfinedRun } from '../../src/sandbox/runner';
import type { PreparedRun } from '../../src/sandbox/validate';
import { buildFakeFetcher } from '../helpers/fake-fetcher';
import {
  confinedSkipReason,
  execSandbox,
  experimentId,
  fetchArgs,
  findFfmpeg,
  makeClip,
  skipMessage,
  tempRoot,
} from '../helpers/sandbox';

const skip = confinedSkipReason();
skipMessage('sandbox confinement', skip);

let temp: { root: string; cleanup: () => void };
let scratch: string;
let home: string;
beforeEach(() => {
  temp = tempRoot();
  scratch = join(temp.root, 'scratch', 'exp');
  home = join(temp.root, 'home');
  mkdirSync(join(scratch, 'tmp'), { recursive: true });
  mkdirSync(home);
  writeFileSync(join(scratch, 'experiment.json'), '{}');
});
afterEach(() => temp.cleanup());

/** A confined FFmpeg run with no validation at all: only the profile stands in the way. */
function rawRun(args: string[], options: { program?: string; inputs?: string[] } = {}): ConfinedRun {
  const found = findFfmpeg();
  if ('skip' in found) throw new Error(found.skip);
  const prepared: PreparedRun = {
    profile: 'offline',
    programName: 'ffmpeg',
    program: found.ffmpeg,
    args,
    inputs: options.inputs ?? [],
    outputDirs: [],
  };
  return {
    sandboxExec: '/usr/bin/sandbox-exec',
    profile: profilePath(defaultProfilesDir(), 'offline'),
    params: profileParams(prepared, { dir: scratch, home }),
    program: options.program ?? found.ffmpeg,
    args,
    cwd: scratch,
    env: { PATH: '/usr/bin:/bin', TMPDIR: join(scratch, 'tmp') },
    // What these runs prove is confinement, not speed (sandbox-limits.test.ts owns the limits). A 30 s wall
    // cut a 0.1 s FFmpeg run short at load 30, while the scanner checked every library it loads. 100 s stays
    // under the product's default (120 s) and inside the describe's 120 s timeout.
    limits: { ...DEFAULT_SANDBOX_LIMITS, wallMs: 100_000 },
    watch: { dir: scratch, maxBytes: 100 * 1024 ** 2 },
    handlesCpuSignal: true,
  };
}
const lavfi = [
  '-hide_banner',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'color=red:size=64x64:duration=0.1',
  '-frames:v',
  '1',
];

describe.skipIf(skip !== '')('the offline profile (validator skipped)', { timeout: 120_000 }, () => {
  it('lets FFmpeg write in scratch', async () => {
    const result = await runConfined(rawRun([...lavfi, join(scratch, 'ok.png')]));
    expect(result.ok && result.value.exitCode).toBe(0);
    expect(existsSync(join(scratch, 'ok.png'))).toBe(true);
  });

  it('refuses writes outside scratch, and to the manifest', async () => {
    const outside = join(temp.root, 'escaped.png');
    const result = await runConfined(rawRun([...lavfi, outside]));
    expect(result.ok && result.value.exitCode).not.toBe(0);
    expect(result.ok && result.value.stderrTail).toMatch(/Operation not permitted/);
    expect(existsSync(outside)).toBe(false);
    const manifest = await runConfined(rawRun([...lavfi, '-f', 'image2', join(scratch, 'experiment.json')]));
    expect(manifest.ok && manifest.value.exitCode).not.toBe(0);
    expect(readFileSync(join(scratch, 'experiment.json'), 'utf8')).toBe('{}');
  });

  it('cannot read the home folder outside the grants, and can read a granted input there', async () => {
    const clip = join(home, 'clip.mp4');
    const found = findFfmpeg();
    if ('skip' in found) return;
    makeClip(found.ffmpeg, clip);
    const denied = await runConfined(rawRun(['-hide_banner', '-i', clip, '-f', 'null', '-']));
    expect(denied.ok && denied.value.exitCode).not.toBe(0);
    expect(denied.ok && denied.value.stderrTail).toMatch(/Operation not permitted/);
    const granted = await runConfined(
      rawRun(['-hide_banner', '-i', clip, '-f', 'null', '-'], { inputs: [clip] }),
    );
    expect(granted.ok && granted.value.exitCode).toBe(0);
  });

  it('refuses the network: a local HTTP server sees no connection', async () => {
    let connections = 0;
    const server = createHttpServer((_req, res) => res.end('x'));
    server.on('connection', () => connections++);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const result = await runConfined(
        rawRun(['-hide_banner', '-i', `http://127.0.0.1:${port}/x.mp4`, '-f', 'null', '-']),
      );
      expect(result.ok && result.value.exitCode).not.toBe(0);
      expect(result.ok && result.value.stderrTail).toMatch(/Operation not permitted/);
      expect(connections).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('refuses any program but the one named', async () => {
    const result = await runConfined({ ...rawRun([scratch]), program: '/bin/ls' });
    expect(!result.ok && result.error.code).toBe('sandbox.program_not_allowed');
  });
});

describe.skipIf(skip !== '')('the sandbox', { timeout: 120_000 }, () => {
  it('runs FFmpeg in an experiment and reports what it wrote', async () => {
    const { sandbox } = execSandbox(join(temp.root, 'root'));
    const id = experimentId();
    await sandbox.open({ id, projectId: null, purpose: 'analysis' });
    const result = await sandbox.run(id, {
      program: 'ffmpeg',
      args: [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=128x72:rate=10:duration=1',
        '-vf',
        'fps=2',
        'scratch:frames/%02d.png',
      ],
    });
    expect(result.ok && result.value.exitCode).toBe(0);
    expect(result.ok && result.value.written.map((file) => file.path)).toEqual([
      'frames/01.png',
      'frames/02.png',
    ]);
    const bad = await sandbox.run(id, {
      program: 'ffmpeg',
      args: ['-i', 'scratch:frames/01.png', '-vf', 'scale=w=abc', 'scratch:x.png'],
    });
    expect(bad.ok && bad.value.exitCode).not.toBe(0);
    const refused = await sandbox.run(id, {
      program: 'ffmpeg',
      args: ['-i', 'http://127.0.0.1/x', 'scratch:x.png'],
    });
    expect(!refused.ok && refused.error.code).toBe('sandbox.argument_rejected');
  });

  it('decodes with VideoToolbox under the profile', async () => {
    const { sandbox, ffmpeg } = execSandbox(join(temp.root, 'root'));
    const id = experimentId();
    const opened = await sandbox.open({ id, projectId: null, purpose: 'analysis' });
    if (!opened.ok) throw new Error('open failed');
    makeClip(ffmpeg.ffmpeg, join(opened.value.dir, 'clip.mp4'));
    const lines: string[] = [];
    const result = await sandbox.run(
      id,
      {
        program: 'ffmpeg',
        args: ['-v', 'verbose', '-hwaccel', 'videotoolbox', '-i', 'scratch:clip.mp4', '-f', 'null', '-'],
      },
      { onOutputLine: (stream, line) => stream === 'stderr' && lines.push(line) },
    );
    expect(result.ok && result.value.exitCode).toBe(0);
    expect(lines.join('\n')).toMatch(/pix_fmt: videotoolbox_vld/);
    expect(lines.join('\n')).toMatch(/30 frames decoded; 0 decode errors/);
  });

  it('probes and caps stdout at 64 KiB', async () => {
    const { sandbox } = execSandbox(join(temp.root, 'root'));
    const id = experimentId();
    await sandbox.open({ id, projectId: null, purpose: 'analysis' });
    const crc = await sandbox.run(id, {
      program: 'ffmpeg',
      args: ['-f', 'lavfi', '-i', 'testsrc2=size=32x32:rate=30:duration=90', '-f', 'framecrc', '-'],
    });
    expect(crc.ok && crc.value.exitCode).toBe(0);
    expect(crc.ok && Buffer.byteLength(crc.value.stdout)).toBeLessThanOrEqual(64 * 1024);
    expect(crc.ok && crc.value.stdout.length).toBeGreaterThan(60_000);
  });
});

describe.skipIf(skip !== '')('the fetcher profile', { timeout: 120_000 }, () => {
  let tcp: Server;
  let port = 0;
  let connections = 0;
  let fake: { binary: string; deno: string } | null = null;
  let componentDir = '';
  beforeAll(async () => {
    tcp = createTcpServer((socket) => {
      connections++;
      socket.end();
    });
    await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve));
    port = (tcp.address() as AddressInfo).port;
    const dir = tempRoot('taalcut-fetcher-');
    componentDir = join(dir.root, 'reference-fetcher');
    fake = buildFakeFetcher(componentDir);
    if (!fake) console.warn('sandbox fetcher: skipped the fake yt-dlp, no C compiler (/usr/bin/cc).');
  });
  afterAll(async () => {
    await new Promise((resolve) => tcp.close(resolve));
  });

  it('runs yt-dlp with the network on and writes the reel into the experiment', async (context) => {
    if (!fake) return context.skip();
    const found = findFfmpeg();
    if ('skip' in found) return context.skip();
    const binaries = { ...fake, ffmpegDir: found.dir, componentDirs: [componentDir] };
    const { sandbox } = execSandbox(join(temp.root, 'root'), {
      programs: { ffmpeg: found.ffmpeg, ffprobe: found.ffprobe, ytDlp: async () => ok(binaries) },
    });
    const id = experimentId();
    await sandbox.open({ id, projectId: null, purpose: 'breakdown' });
    const before = connections;
    const result = await sandbox.run(id, {
      program: 'ytDlp',
      args: fetchArgs(`https://127.0.0.1:${port}/shorts/abc`),
      network: 'outbound',
      limits: { wallMs: 60_000 },
    });
    expect(result.ok && result.value.exitCode).toBe(0);
    expect(result.ok && result.value.stderrTail).toMatch(/network:yes/);
    expect(connections).toBeGreaterThan(before);
    expect(result.ok && result.value.written.map((file) => file.path)).toEqual(['reference.mp4']);
    expect(result.ok && result.value.stdout.trim()).toMatch(/reference\.mp4$/);
  });

  it('the same program under the offline profile gets no network', async (context) => {
    if (!fake) return context.skip();
    copyFileSync(fake.binary, join(scratch, 'yt-dlp'));
    const before = connections;
    const found = findFfmpeg();
    if ('skip' in found) return context.skip();
    const args = [
      '-o',
      join(scratch, 'r.%(ext)s'),
      '--ffmpeg-location',
      found.dir,
      '--',
      `https://127.0.0.1:${port}/x`,
    ];
    const run = rawRun(args, { program: join(scratch, 'yt-dlp') });
    const params = run.params.map(
      ([name, value]) => [name, name === 'PROGRAM' ? join(scratch, 'yt-dlp') : value] as const,
    );
    const result = await runConfined({ ...run, params });
    expect(result.ok && result.value.stderrTail).toMatch(/network:no/);
    expect(connections).toBe(before);
  });
});
