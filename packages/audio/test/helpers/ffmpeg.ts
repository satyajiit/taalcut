// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Real ffmpeg for synthetic fixtures, checked once per test run before any file starts (ffmpeg-setup.ts; media's
 * test-support-ffmpeg.ts, with a deadline about FFmpeg hanging rather than the machine being busy). Suites skip
 * when the dev build is absent; any other failure of the check has stopped the run.
 */
import { type MediaContext } from '@taalcut/media';
import { testFfmpegFor } from '@taalcut/media/test-support';
import { inject } from 'vitest';

export async function testMedia(suite: string): Promise<{ ctx?: MediaContext; skip: string }> {
  const { binaries, skip } = testFfmpegFor(inject('testFfmpeg'), suite);
  return binaries ? { ctx: { binaries }, skip: '' } : { skip };
}
