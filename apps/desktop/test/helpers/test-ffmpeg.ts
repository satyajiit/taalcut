// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, type Result } from '@taalcut/core';
import { FfmpegNotFound, type ResolvedFfmpeg } from '@taalcut/media';
import { testFfmpegFor } from '@taalcut/media/test-support';
import { inject } from 'vitest';

/**
 * The development FFmpeg for suites that run it, checked once per test run before any file starts
 * (ffmpeg-setup.ts; media's test-support-ffmpeg.ts, with a deadline about FFmpeg hanging rather than the machine
 * being busy). Only a missing FFmpeg (a checkout or CI that hasn't built tools/ffmpeg) comes back as an error, for
 * the suite to skip; any other failure of the check has already stopped the run.
 */
export async function testFfmpeg(suite: string): Promise<Result<ResolvedFfmpeg>> {
  const { binaries, skip } = testFfmpegFor(inject('testFfmpeg'), suite);
  return binaries ? ok(binaries) : err(FfmpegNotFound({ binary: 'ffmpeg' }, { detail: skip }));
}
