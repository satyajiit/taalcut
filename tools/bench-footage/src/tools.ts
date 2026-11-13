// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FootageTools on this Mac: the bundled LGPL FFmpeg (tools/ffmpeg/dist, found by walking up from here, or
 * TAALCUT_FFMPEG_DIR) under a stall watch, and macOS `say`.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { FootageTools } from './generate';
import { runWatched, type StallWatch } from './stall';

const run = promisify(execFile);

/**
 * One FFmpeg call may run this long before it counts as stalled (a wedged hardware encoder). A stalled call is
 * reported and no longer waited for; it is never killed (stall.ts).
 */
export const FFMPEG_STALL_MS = 20 * 60_000;

/** `tools/ffmpeg/dist/ffmpeg` above this file, or in TAALCUT_FFMPEG_DIR. */
export function bundledFfmpeg(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const fromEnv = env.TAALCUT_FFMPEG_DIR?.trim();
  if (fromEnv && existsSync(join(fromEnv, 'ffmpeg'))) return join(fromEnv, 'ffmpeg');
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, 'tools', 'ffmpeg', 'dist', 'ffmpeg');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * `say -v '?'` lines: "<name>  <locale>  # <sample>"; names may hold spaces and brackets. Newer macOS lists a
 * classic voice only by its long name ("Daniel (English (UK))"), though `say -v Daniel` still takes the short one:
 * both are listed, each once.
 */
export function parseVoices(text: string): string[] {
  const names = text
    .split('\n')
    .map((line) => /^(.*?)\s+[a-z]{2,3}_[A-Za-z0-9]+\s+#/.exec(line)?.[1]?.trim())
    .filter((name): name is string => name !== undefined && name !== '')
    .flatMap((name) => {
      const short = /^(.+?) \(.+\(.+\)\)$/.exec(name)?.[1];
      return short ? [name, short] : [name];
    });
  return [...new Set(names)];
}

/** `stall.reportDir` gets a report for each stalled call (and each running call's stderr meanwhile). */
export function systemTools(
  ffmpeg: string,
  stall: Pick<StallWatch, 'reportDir'> & Partial<StallWatch>,
): FootageTools {
  const watch: StallWatch = { stallMs: FFMPEG_STALL_MS, ...stall };
  return {
    ffmpeg: (args) => runWatched(ffmpeg, args, watch),
    async ffmpegVersion() {
      const { stdout } = await run(ffmpeg, ['-hide_banner', '-version']);
      return stdout.split('\n')[0] ?? 'unknown';
    },
    async voices() {
      const { stdout } = await run('/usr/bin/say', ['-v', '?']);
      return parseVoices(stdout);
    },
    async say(speech) {
      await run('/usr/bin/say', ['-v', speech.voice, '-o', speech.path, speech.text]);
    },
  };
}
