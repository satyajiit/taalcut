// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Sandbox test helpers: the bundled FFmpeg (TAALCUT_FFMPEG_DIR, else the
 * repo's tools/ffmpeg/dist; tools may not import @taalcut/media), a scratch
 * root per test, and a fixed clock. Suites that need sandbox-exec or FFmpeg
 * skip with a message when they're missing.
 */
import { execFileSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createManualClock, newId, type ExperimentId } from '@taalcut/core';
import { createExperimentSandbox, SANDBOX_EXEC, type ExecSandboxOptions } from '@taalcut/tools';

const REPO_DIST = fileURLToPath(new URL('../../../../tools/ffmpeg/dist/', import.meta.url));

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The FFmpeg pair, or why not. */
export function findFfmpeg(): { ffmpeg: string; ffprobe: string; dir: string } | { skip: string } {
  const dir = process.env.TAALCUT_FFMPEG_DIR ?? REPO_DIST;
  const ffmpeg = join(dir, 'ffmpeg');
  const ffprobe = join(dir, 'ffprobe');
  if (!executable(ffmpeg) || !executable(ffprobe))
    return { skip: `no FFmpeg in ${dir} (set TAALCUT_FFMPEG_DIR or build tools/ffmpeg)` };
  return { ffmpeg: realpathSync(ffmpeg), ffprobe: realpathSync(ffprobe), dir: realpathSync(dir) };
}

/** Why the confined suites can't run here, or '' when they can. */
export function confinedSkipReason(): string {
  if (process.platform !== 'darwin') return 'not macOS';
  if (!executable(SANDBOX_EXEC)) return `${SANDBOX_EXEC} is missing`;
  const found = findFfmpeg();
  return 'skip' in found ? found.skip : '';
}

export function skipMessage(suite: string, reason: string): void {
  if (reason) console.warn(`${suite}: skipped, ${reason}.`);
}

/** A fresh scratch root under the OS temp folder (in /private/var/folders on macOS). */
export function tempRoot(prefix = 'taalcut-sandbox-'): { root: string; cleanup: () => void } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export function experimentId(): ExperimentId {
  return newId<'Experiment'>();
}

/** An exec-mode sandbox over the bundled FFmpeg. */
export function execSandbox(root: string, extra: Partial<ExecSandboxOptions> = {}) {
  const found = findFfmpeg();
  if ('skip' in found) throw new Error(found.skip);
  const clock = createManualClock(1_000_000);
  const sandbox = createExperimentSandbox({
    root,
    clock,
    programs: { ffmpeg: found.ffmpeg, ffprobe: found.ffprobe },
    freeSpaceReserve: 0,
    ...extra,
  });
  return { sandbox, clock, ffmpeg: found };
}

/** Makes a small H.264 file with VideoToolbox (outside any sandbox), for decode tests. */
export function makeClip(ffmpeg: string, out: string, seconds = 1): void {
  execFileSync(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=320x240:rate=30:duration=${seconds}`,
    '-c:v',
    'h264_videotoolbox',
    '-b:v',
    '1M',
    out,
  ]);
}

/** The fetcher's argv as templates builds it (research note, "Flags"). */
export function fetchArgs(url = 'https://www.youtube.com/shorts/abc'): string[] {
  return [
    '--ignore-config',
    '--no-plugin-dirs',
    '--no-update',
    '--no-cache-dir',
    '--js-runtimes',
    'deno',
    '--ffmpeg-location',
    'ffmpeg',
    '--no-playlist',
    '--max-downloads',
    '1',
    '-f',
    'bv*[height<=720]+ba/b[height<=720]/wv*+ba/w',
    '--merge-output-format',
    'mp4',
    '--max-filesize',
    '80M',
    '--socket-timeout',
    '20',
    '--retries',
    '3',
    '--fragment-retries',
    '3',
    '--no-mtime',
    '--newline',
    '--progress',
    '--progress-template',
    'download:{"status":%(progress.status)j}',
    '--print',
    'after_move:filepath',
    '-o',
    'scratch:reference.%(ext)s',
    '--',
    url,
  ];
}
