// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-FIX: the format a VideoToolbox decode downloads in before a CPU filter (the proxy's and the conform's
 * graph). `hwdownload` can't convert, so it must name the surface the decoder made, which follows the stream's
 * depth: an 8-bit HLG stream (some phones record one) is nv12, and p010le of it exited 234. Deeper than 8 bits
 * stays p010le, HDR or not, and so does HDR of unknown depth (nearly always 10-bit).
 */
import { describe, expect, it } from 'vitest';
import { planNormalisation, type NormalisationPlan, type VideoStreamInfo } from '@taalcut/media';
import type { ToneMapChoice } from '../../src/backends';
import { normalisationGraph } from '../../src/normalise/graph';
import { probeOf, videoStream } from '../helpers/probe-fixture';

const placebo: ToneMapChoice = { method: 'libplacebo', backend: 'vulkan', curve: 'bt.2446a' };
const none: ToneMapChoice = { method: 'none', backend: 'software' };
const HLG_COLOUR = { transfer: 'arib-std-b67', primaries: 'bt2020', space: 'bt2020nc', range: 'tv' };
const PQ_COLOUR = { ...HLG_COLOUR, transfer: 'smpte2084' };

/** A 1080p plan decoded on VideoToolbox. */
function macPlan(overrides: Partial<VideoStreamInfo>): NormalisationPlan {
  const video = videoStream({
    codec: 'hevc',
    width: 1920,
    height: 1080,
    displayWidth: 1920,
    displayHeight: 1080,
    ...overrides,
  });
  const result = planNormalisation(probeOf('/clip.mov', video), { platform: 'darwin' });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

/** The plan with its source's depth not known. */
function depthUnknown(known: NormalisationPlan): NormalisationPlan {
  const { bitDepth: _known, ...source } = known.source;
  return { ...known, source };
}

/** The proxy's graph: a CPU encoder after the tone map (or the CPU filters), so the frames download. */
const proxyFilter = (plan: NormalisationPlan, toneMap: ToneMapChoice) =>
  normalisationGraph(plan, { route: plan.decode, toneMap, size: { longSide: 640 }, encoder: 'libopenh264' })
    .videoFilter;

describe('VideoToolbox download format', () => {
  const hlg8 = macPlan({
    isHdr: true,
    hdrFormats: ['hlg'],
    bitDepth: 8,
    pixelFormat: 'yuv420p',
    colour: HLG_COLOUR,
  });

  it('downloads 8-bit HLG as the nv12 it decodes to, into the tone map', () => {
    expect(hlg8.decode).toEqual({ backend: 'videotoolbox', surfaceFormat: 'nv12' });
    const filter = proxyFilter(hlg8, placebo);
    expect(filter).toContain('hwdownload,format=nv12,');
    expect(filter).not.toContain('p010le');
    expect(filter).toContain('libplacebo');
  });

  it('downloads 10-bit HLG and PQ as p010le', () => {
    for (const colour of [HLG_COLOUR, PQ_COLOUR]) {
      const plan = macPlan({
        isHdr: true,
        hdrFormats: [colour === PQ_COLOUR ? 'pq' : 'hlg'],
        bitDepth: 10,
        pixelFormat: 'yuv420p10le',
        colour,
      });
      expect(proxyFilter(plan, placebo), colour.transfer).toContain('hwdownload,format=p010le,');
    }
  });

  it('keeps p010le for HDR of unknown depth', () => {
    expect(proxyFilter(depthUnknown(hlg8), placebo)).toContain('hwdownload,format=p010le,');
  });

  it('downloads 10-bit SDR as p010le, and 8-bit SDR as nv12', () => {
    const sdr10 = macPlan({
      bitDepth: 10,
      pixelFormat: 'yuv420p10le',
      colour: { space: 'bt709', primaries: 'bt709', transfer: 'bt709', range: 'tv' },
    });
    expect(proxyFilter(sdr10, none)).toContain('hwdownload,format=p010le');
    const sdr8 = macPlan({ colour: { space: 'bt709', primaries: 'bt709', transfer: 'bt709', range: 'tv' } });
    expect(proxyFilter(sdr8, none)).not.toContain('p010le');
  });
});
