// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The bundled FFmpeg for synthetic reels: TAALCUT_FFMPEG_DIR, else the
 * repo's tools/ffmpeg/dist. Suites skip with a message when it's missing
 * (templates can't import @taalcut/media's resolver: PRD 6.2 layering).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FfmpegBinaryPaths } from '../../src/test-support';

export function findFfmpeg(suite: string): { bins?: FfmpegBinaryPaths; skip: string } {
  const dirs = [
    process.env.TAALCUT_FFMPEG_DIR,
    fileURLToPath(new URL('../../../../tools/ffmpeg/dist/', import.meta.url)),
  ].filter((dir): dir is string => Boolean(dir));
  for (const dir of dirs) {
    const bins = { ffmpeg: join(dir, 'ffmpeg'), ffprobe: join(dir, 'ffprobe') };
    if (existsSync(bins.ffmpeg) && existsSync(bins.ffprobe)) return { bins, skip: '' };
  }
  const skip = `${suite}: skipped, no FFmpeg. Set TAALCUT_FFMPEG_DIR or build tools/ffmpeg.`;
  console.warn(skip);
  return { skip };
}
