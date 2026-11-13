// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-F5 (M5): the refusing-VideoToolbox stand-in plays `-allow_sw 1` as VideoToolbox does: a refused hardware
 * session quietly becomes a software encoder, the run succeeds and prints no refusal, so no logged retry can follow.
 * Render's own routes no longer ask for it (segment-args.test.ts, apply-grade.test.ts). `/usr/bin/true` stands in
 * for FFmpeg here: nothing is encoded.
 */
import { describe, expect, it } from 'vitest';
import { ENCODER_REFUSED, refusingVideoToolbox } from '../support/refusing';

const ENCODE = ['-i', 'in.mov', '-c:v', 'h264_videotoolbox', '-b:v', '40M'];

describe('the refusing VideoToolbox stand-in', () => {
  it('refuses a VideoToolbox encoder with the compression-session line', async () => {
    const refusing = refusingVideoToolbox({ decode: false });
    const run = await refusing.runner('/usr/bin/true', ENCODE);
    expect(run.ok && run.value.exitCode).toBe(1);
    expect(run.ok && run.value.stderrTail).toBe(ENCODER_REFUSED);
  });

  it('lets -allow_sw 1 succeed in software with no refusal, as VideoToolbox would', async () => {
    const refusing = refusingVideoToolbox({ decode: false });
    const run = await refusing.runner('/usr/bin/true', [...ENCODE, '-allow_sw', '1', 'out.mp4']);
    expect(run.ok && run.value.exitCode).toBe(0);
    expect(run.ok && run.value.stderrTail).not.toContain('Cannot create compression session');
    expect(refusing.calls).toHaveLength(1);
  });
});
