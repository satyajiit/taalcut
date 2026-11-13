// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpegBuildTarget } from '@taalcut/media';

/**
 * Bundled LGPL ffmpeg/ffprobe, walking up from this file to `tools/ffmpeg/dist`, in this platform's layout (media's
 * build target: `dist/` on a Mac, `dist/linux-x64/bin/` on Linux). Undefined on a platform with no build.
 */
export function bundledFfmpeg(): { ffmpeg: string; ffprobe: string } | undefined {
  const target = ffmpegBuildTarget();
  if (!target) return undefined;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const root = join(dir, 'tools/ffmpeg/dist', target.devFolder, target.binDir);
    const ffmpeg = join(root, 'ffmpeg');
    const ffprobe = join(root, 'ffprobe');
    if (existsSync(ffmpeg) && existsSync(ffprobe)) return { ffmpeg, ffprobe };
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
