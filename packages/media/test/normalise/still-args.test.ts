// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Still encode flags: one JPEG, quality 2, and no double rotation. */
import { writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { makeStill, planNormalisation, type ProcessRunner } from '@taalcut/media';
import { probeOf, videoStream } from '../helpers/probe-fixture';

describe('makeStill arguments', () => {
  it('writes one q=2 JPEG and turns a rotated still in software', async () => {
    const video = videoStream({ frameCount: 1, rotation: 90, displayWidth: 240, displayHeight: 320, codec: 'mjpeg' });
    const planned = planNormalisation(probeOf('/still.jpg', video));
    expect(planned.ok && planned.value.kind).toBe('image');
    if (!planned.ok) return;
    const dir = await mkdtemp(join(tmpdir(), 'taalcut-still-'));
    const out = join(dir, 'still.jpg');
    const seen: string[][] = [];
    const runner: ProcessRunner = async (_command, args) => {
      seen.push([...args]);
      await writeFile(out, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      return ok({ exitCode: 0, signal: null, stdout: Buffer.alloc(0), stderrTail: '', durationMs: 1 });
    };
    const result = await makeStill('/still.jpg', planned.value, {
      binaries: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', source: 'dev-build' },
      runner,
    }, { out });
    expect(result.ok && result.value).toMatchObject({ width: 240, height: 320 });
    const text = seen.map((args) => args.join(' ')).join('\n');
    expect(text).toContain('-frames:v 1');
    expect(text).toContain('-q:v 2');
    expect(text).toContain('-update 1');
    expect(text).toContain('-noautorotate');
  });
});
