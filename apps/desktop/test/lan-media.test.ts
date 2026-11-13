// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The lan process's media port (P2-L3): an upload is probed with the app's
 * FFmpeg, so the re-encode check sees its codecs; a file FFmpeg can't read
 * answers `{ ok: false }` and still imports with an unknown verdict.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { lanMedia } from '../src/utility/roots/lan-media';
import { testConfig } from './helpers/roots';
import { testFfmpeg } from './helpers/test-ffmpeg';

const ffmpeg = await testFfmpeg('lan media');
const dir = mkdtempSync(join(tmpdir(), 'taalcut-lan-media-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!ffmpeg.ok)('lan media probe', () => {
  it('reads an upload with the app FFmpeg, and answers ok: false for bytes it cannot read', async () => {
    const clip = join(dir, 'clip.mp4');
    execFileSync(ffmpeg.ok ? ffmpeg.value.ffmpeg : 'ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-t', '1'],
      ...['-c:v', 'mpeg4', clip],
    ]);
    const media = lanMedia(testConfig('lan'));
    const probed = await media.probe(clip);
    expect(probed).toMatchObject({ container: { formatName: expect.stringContaining('mp4') } });

    const junk = join(dir, 'junk.mov');
    writeFileSync(junk, Buffer.alloc(4096, 7));
    expect(await media.probe(junk)).toMatchObject({ ok: false });
    // FFmpeg runs three times (encode, two probes): seconds under a full `pnpm check`.
  }, 30_000);
});
