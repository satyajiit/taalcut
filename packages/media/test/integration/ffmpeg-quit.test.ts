// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-K2 with the real FFmpeg: a run that may hold a video session is stopped by its `q` on stdin (no
 * `-nostdin`), before any signal. The run itself is software only (a test pattern to the null muxer), so no
 * VideoToolbox session is involved: the no-kill path is never tried on a real stuck session.
 */
import { describe, expect, it } from 'vitest';
import { runFfmpeg } from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';

const found = await findTestBinaries('FFmpeg quits on q');
const binaries = found.binaries;
const PATTERN = ['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30:duration=600', '-f', 'null', '-'];

describe.skipIf(!binaries)('FFmpeg asked to stop', () => {
  it('finishes on q, with no signal', async () => {
    if (!binaries) throw new Error('no FFmpeg');
    const controller = new AbortController();
    let stoppedAt = 0;
    const result = await runFfmpeg({ binaries }, PATTERN, {
      signal: controller.signal,
      holdsVideoSession: true,
      onProgress: (progress) => {
        if (stoppedAt || progress.frame === undefined || progress.frame < 30) return;
        stoppedAt = Date.now();
        controller.abort();
      },
      progressIntervalMs: 100,
    });
    expect(!result.ok && result.error.code).toBe('media.cancelled');
    const detail = (!result.ok && result.error.detail) || '';
    expect(detail).toMatch(/stopped \(cancelled\) with q on stdin, ended by exit code \d+/);
    expect(detail).not.toContain('SIGTERM');
    expect(Date.now() - stoppedAt).toBeLessThan(2000);
  }, 30_000);

  it('a CPU run declared as such still gets -nostdin and SIGTERM', async () => {
    if (!binaries) throw new Error('no FFmpeg');
    const controller = new AbortController();
    let stopped = false;
    const result = await runFfmpeg({ binaries }, PATTERN, {
      signal: controller.signal,
      holdsVideoSession: false,
      onProgress: (progress) => {
        if (stopped || progress.frame === undefined || progress.frame < 30) return;
        stopped = true;
        controller.abort();
      },
      progressIntervalMs: 100,
    });
    expect(!result.ok && result.error.detail).toMatch(
      /stopped \(cancelled\) with SIGTERM, ended by exit code 255/,
    );
  }, 30_000);
});
