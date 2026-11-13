// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Derived-file time for a 4K 60 s clip on this machine. The M1 30 s figure
 * is nightly (P2-Q4). This test fails only above 120 s.
 */
import { stat } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { makeFilmstrip, makePreviews, makeProxy, type MediaContext } from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';
import { hardwareHevcEncoder, planClip, renderClip } from '../helpers/clip';

const found = await findTestBinaries('media proxy timing');

describe.skipIf(!found.binaries)('4K derived files', () => {
  let dir = '';

  afterAll(() => (dir ? rm(dir, { recursive: true, force: true }) : undefined));

  it('makes a proxy and previews of a 4K 60 s clip', async (t) => {
    const ctx: MediaContext = { binaries: found.binaries! };
    const hevc = await hardwareHevcEncoder(ctx);
    if (!hevc) return t.skip('no hardware HEVC encoder');
    dir = await mkdtemp(join(tmpdir(), 'taalcut-4k-'));
    const source = join(dir, '4k60.mp4');
    const encoded = await renderClip(ctx, source, [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=3840x2160:rate=30',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000',
      '-t',
      '60',
      '-c:v',
      hevc,
      '-b:v',
      '12M',
      '-tag:v',
      'hvc1',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
    ]);
    if (!encoded) return t.skip('4K 60 s fixture was not encoded');
    const plan = await planClip(source, ctx);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const size = (await stat(source)).size;
    const proxy = join(dir, 'proxy.mp4');
    const started = Date.now();
    const made = await makeProxy(source, plan.value, ctx, {
      out: proxy,
      sizeBytes: size,
      contentHash: '11'.repeat(32),
    });
    if (!made.ok) console.warn(`MEASURE 4k-60s-proxy-error ${made.error.detail ?? made.error.code}`);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const read = made.value.reusedOriginal ? source : proxy;
    const alreadyNormalised = !made.value.reusedOriginal;
    const strip = await makeFilmstrip(read, plan.value, ctx, {
      alreadyNormalised,
      out: join(dir, 'strip.jpg'),
    });
    const previews = strip.ok
      ? await makePreviews(read, plan.value, ctx, {
          alreadyNormalised,
          out: { waveform: join(dir, 'wave.bin') },
        })
      : strip;
    const elapsed = Date.now() - started;
    console.warn(`MEASURE 4k-60s-derived-ms ${elapsed}`);
    console.warn(`MEASURE 4k-60s-proxy-ratio ${made.value.ratio}`);
    console.warn(`MEASURE 4k-60s-proxy-bytes ${made.value.file?.bytes ?? 0}`);
    if (!previews.ok)
      console.warn(`MEASURE 4k-60s-previews-error ${previews.error.detail ?? previews.error.code}`);
    expect(previews.ok).toBe(true);
    expect(elapsed).toBeLessThan(120_000);
  }, 300_000);
});
