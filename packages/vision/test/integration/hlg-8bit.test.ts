// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-FIX: an 8-bit HLG clip (some phones record one) through the shots job's decode. Its VideoToolbox surface is
 * nv12, and `hwdownload` can't convert, so the download before the tone map must name nv12: p010le failed the pass
 * (exit 234, "Invalid output format p010le for hwframe download"). The clip is a synthetic reel, its H.264 colour
 * tags rewritten to BT.2020 HLG with FFmpeg's h264_metadata (no re-encode).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planNormalisation, probeMedia, runFfmpeg, type NormalisationPlan } from '@taalcut/media';
import { openFrameSource } from '../../src/media/media-frame-source';
import { detectShots } from '../../src/shots/detect-shots';
import { makeReel, testMedia } from '../helpers/reel';

const { ctx } = await testMedia('8-bit HLG');

/** BT.2020 primaries (9), ARIB STD-B67 transfer (18), BT.2020 non-constant matrix (9), limited range. */
const HLG_TAGS =
  'h264_metadata=video_full_range_flag=0:colour_primaries=9:transfer_characteristics=18:matrix_coefficients=9';

describe.skipIf(!ctx)('an 8-bit HLG clip', () => {
  let dir: string;
  let path: string;
  let plan: NormalisationPlan;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-hlg8-'));
    const sdr = join(dir, 'sdr.mp4');
    path = join(dir, 'hlg8.mov');
    await makeReel(
      ctx!,
      sdr,
      [
        { source: 'testsrc2', frames: 45 },
        { source: 'smptebars', frames: 40 },
      ],
      { width: 640, height: 360, rate: '30' },
    );
    const tagged = await runFfmpeg(ctx!, [
      ...['-y', '-i', sdr, '-c', 'copy', '-bsf:v', HLG_TAGS],
      ...['-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc', path],
    ]);
    if (!tagged.ok) throw new Error(`${tagged.error.code} ${tagged.error.detail ?? ''}`);
    const probed = await probeMedia(path, ctx!);
    if (!probed.ok) throw new Error(probed.error.code);
    const planned = planNormalisation(probed.value);
    if (!planned.ok) throw new Error(planned.error.code);
    plan = planned.value;
  }, 120_000);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('is planned as 8-bit HDR that needs a tone map', () => {
    expect(plan.source).toMatchObject({ bitDepth: 8 });
    expect(plan.toneMap).toBe('required');
    if (process.platform === 'darwin')
      expect(plan.decode).toMatchObject({ backend: 'videotoolbox', surfaceFormat: 'nv12' });
  });

  it('decodes for the shots job and finds its cut', async () => {
    const opened = await openFrameSource({ media: ctx!, tempDir: dir }, { assetId: 'hlg8', path, plan });
    if (!opened.ok) throw new Error(opened.error.code);
    const shots = await detectShots(path, { media: ctx!, frames: opened.value });
    await opened.value.close();
    expect(shots.ok ? null : shots.error).toBeNull();
    if (!shots.ok) return;
    expect(shots.value.cuts.map((cut) => cut.frame)).toEqual([45]);
    expect(opened.value.decodes()).toMatchObject({ fullDecodes: 1 });
  }, 120_000);
});
