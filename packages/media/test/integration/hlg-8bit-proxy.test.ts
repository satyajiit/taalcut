// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-FIX: the proxy of an 8-bit HLG clip (some phones record one), the file the app plays. Its hardware decode
 * hands back nv12, and `hwdownload` can't convert, so the download into the tone map must name nv12: p010le failed
 * the proxy (exit 234). The clip is synthetic: OpenH264 at 8 bits, its colour tags rewritten to BT.2020 HLG with
 * FFmpeg's h264_metadata.
 */
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeProxy, probeMedia, runFfmpeg, type MediaContext } from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';
import { h264Encoder, planClip, renderClip } from '../helpers/clip';

const found = await findTestBinaries('8-bit HLG proxy');

/** BT.2020 primaries (9), ARIB STD-B67 transfer (18), BT.2020 non-constant matrix (9), limited range. */
const HLG_TAGS =
  'h264_metadata=video_full_range_flag=0:colour_primaries=9:transfer_characteristics=18:matrix_coefficients=9';

describe.skipIf(!found.binaries)('the proxy of an 8-bit HLG clip', () => {
  let dir: string;
  let ctx: MediaContext;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-hlg8-proxy-'));
    ctx = { binaries: found.binaries! };
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('is made, tone-mapped to SDR', async (t) => {
    const h264 = await h264Encoder(ctx);
    if (!h264) return t.skip('no H.264 encoder');
    const sdr = join(dir, 'sdr.mp4');
    const encoded = await renderClip(ctx, sdr, [
      ...['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '2'],
      ...[...h264, '-b:v', '6M'],
    ]);
    if (!encoded) return t.skip('the clip was not encoded');
    const source = join(dir, 'hlg8.mov');
    const tagged = await runFfmpeg(ctx, [
      ...['-y', '-i', sdr, '-c', 'copy', '-bsf:v', HLG_TAGS],
      ...['-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc', source],
    ]);
    expect(tagged.ok).toBe(true);
    const plan = await planClip(source, ctx);
    if (!plan.ok) throw new Error(plan.error.code);
    expect(plan.value.source).toMatchObject({ bitDepth: 8 });
    expect(plan.value.toneMap).toBe('required');
    const out = join(dir, 'hlg8-proxy.mp4');
    const made = await makeProxy(source, plan.value, ctx, { out, sizeBytes: (await stat(source)).size });
    expect(made.ok ? null : made.error).toBeNull();
    const probed = await probeMedia(out, ctx);
    expect(probed.ok && probed.value.video?.colour.transfer).toBe('bt709');
  }, 180_000);
});
