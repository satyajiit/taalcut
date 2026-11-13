// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createBinaryResolver, type ResolvedFfmpeg } from '@taalcut/media';

/**
 * The FFmpeg build the app uses, found the way @taalcut/media finds it in a
 * checkout (TAALCUT_FFMPEG_DIR, else tools/ffmpeg/dist), with its build info
 * checked; the CLIs stop without one. (The tests read the test run's check
 * instead: media's test-support-ffmpeg.ts.)
 */
export async function requireMediaBinaries(): Promise<ResolvedFfmpeg> {
  const resolved = await createBinaryResolver({ development: true }).resolve();
  if (!resolved.ok) throw new Error(`No FFmpeg build (${resolved.error.code}): run tools/ffmpeg/build.sh`);
  return resolved.value;
}
