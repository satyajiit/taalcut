// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Real ffmpeg/ffprobe for integration tests, found the way a development build finds them (TAALCUT_FFMPEG_DIR,
 * else the bundled build in tools/ffmpeg/dist/ checked against its BUILDINFO.json; never PATH). The check runs once
 * per test run, before any file starts (ffmpeg-setup.ts, src/test-support-ffmpeg.ts), and every suite reads its
 * answer here. When none is found the integration suites skip with a message, so CI without FFmpeg still runs
 * everything else; any other failure of the check has already stopped the run.
 */
import { inject } from 'vitest';
import type { ResolvedFfmpeg } from '@taalcut/media';
import { testFfmpegFor } from '@taalcut/media/test-support';

export interface TestBinaries {
  readonly binaries?: ResolvedFfmpeg;
  readonly skipReason: string;
}

export async function findTestBinaries(suite: string): Promise<TestBinaries> {
  const { binaries, skip } = testFfmpegFor(inject('testFfmpeg'), suite);
  return binaries ? { binaries, skipReason: '' } : { skipReason: skip };
}
