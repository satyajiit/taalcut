// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { FrameRate } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { applyRouteWarnings } from '../../src/normalise/types';
import { planNormalisation } from '../../src/normalise/plan';
import { probeOf, videoStream } from '../helpers/probe-fixture';
import type { ProbeResult, VideoStreamInfo } from '../../src/probe/types';

function clip(overrides: Partial<VideoStreamInfo> = {}, probe: Partial<ProbeResult> = {}): ProbeResult {
  const video = videoStream({
    averageFrameRate: { num: 30, den: 1 },
    frameRate: { num: 30, den: 1 },
    duration: { value: 2_000_000, rate: 1_000_000 },
    frameCount: 60,
    startTime: { value: 0, rate: 1_000_000 },
    ...overrides,
  });
  return { ...probeOf('/tmp/clip.mov', video), ...probe, video, streams: [video, ...(probe.streams ?? []).slice(1)] };
}

describe('planNormalisation', () => {
  it('snaps NTSC and keeps 15 fps', () => {
    const ntsc = planNormalisation(
      clip({ averageFrameRate: { num: 30_000, den: 1001 }, frameRate: { num: 30_000, den: 1001 } }),
    );
    expect(ntsc.ok && ntsc.value.frameRate.output).toEqual(FrameRate.of(30_000, 1001));
    const screen = planNormalisation(clip({ averageFrameRate: { num: 15, den: 1 }, frameRate: { num: 15, den: 1 } }));
    expect(screen.ok && screen.value.frameRate.output).toEqual({ num: 15, den: 1 });
  });

  it('marks variable frame rate without changing the grid', () => {
    const plan = planNormalisation(clip({ vfrHint: true, averageFrameRate: { num: 24, den: 1 } }));
    expect(plan.ok && plan.value.facts.variableFrameRate).toBe(true);
    expect(plan.ok && plan.value.frameRate.output).toEqual(FrameRate.of(24));
  });

  it('treats iPhone 240 fps as slow motion at 30 and Android capture fps as already retimed', () => {
    const iphone = planNormalisation(clip({ averageFrameRate: { num: 240, den: 1 }, frameRate: { num: 240, den: 1 } }));
    expect(iphone.ok && iphone.value.speed).toEqual({ kind: 'slow-motion', factor: 8, retimedInFile: false });
    expect(iphone.ok && iphone.value.frameRate.output).toEqual(FrameRate.of(30));
    expect(iphone.ok && iphone.value.frameRate.native).toEqual(FrameRate.of(240));
    const android = planNormalisation(
      clip({ averageFrameRate: { num: 30, den: 1 } }, { phone: { captureFrameRate: 240 } }),
    );
    expect(android.ok && android.value.speed.retimedInFile).toBe(true);
    expect(android.ok && android.value.speed.kind).toBe('slow-motion');
    const lapse = planNormalisation(
      clip({ averageFrameRate: { num: 30, den: 1 } }, { phone: { captureFrameRate: 2 } }),
    );
    expect(lapse.ok && lapse.value.speed.kind).toBe('time-lapse');
    expect(lapse.ok && lapse.value.speed.factor).toBe(15);
  });

  it('records rotation, mirror, HDR and an audio lead', () => {
    const video = videoStream({
      width: 1920,
      height: 1080,
      displayWidth: 1080,
      displayHeight: 1920,
      rotation: 90,
      mirrored: true,
      isHdr: true,
      hdrFormats: ['hlg', 'dolby_vision'],
      dolbyVision: { profile: 8, compatibilityId: 4 },
      averageFrameRate: { num: 30, den: 1 },
      duration: { value: 1_000_000, rate: 1_000_000 },
      frameCount: 30,
      startTime: { value: 0, rate: 1 },
    });
    const audio = {
      kind: 'audio' as const,
      index: 1,
      tags: {},
      startTime: { value: 200, rate: 1000 },
      duration: { value: 5_000_000, rate: 1_000_000 },
    };
    const plan = planNormalisation({
      ...probeOf('/tmp/IMG.MOV', video),
      audio,
      streams: [video, audio],
      phone: { creationDate: '2026-10-01T15:30:00+0530', location: '+19.0760+072.8777+010.000/', make: 'Apple' },
    });
    expect(plan.ok && plan.value.rotation).toBe(90);
    expect(plan.ok && plan.value.warnings).toContain('mirrored');
    expect(plan.ok && plan.value.hdr).toBe('dolby-vision');
    expect(plan.ok && plan.value.toneMap).toBe('required');
    expect(plan.ok && plan.value.facts.orientation).toBe('portrait');
    expect(plan.ok && plan.value.facts.location?.latitude).toBeCloseTo(19.076);
    expect(plan.ok && plan.value.warnings).toContain('audio_longer_than_video');
    expect(plan.ok && plan.value.audio && plan.value.audio.offset.value).not.toBe(0);
  });

  it('warns for Dolby Vision profile 5 only on the CPU tone-map route', () => {
    const video = videoStream({
      isHdr: true,
      hdrFormats: ['dolby_vision'],
      dolbyVision: { profile: 5 },
      averageFrameRate: { num: 24, den: 1 },
      duration: { value: 1_000_000, rate: 1_000_000 },
      frameCount: 24,
    });
    const plan = planNormalisation(probeOf('/tmp/dv5.mov', video));
    expect(plan.ok && plan.value.warnings).not.toContain('dv_profile_5_colours');
    if (!plan.ok) return;
    const warned = applyRouteWarnings(plan.value, {
      method: 'zscale',
      backend: 'software',
      curve: 'hable',
      fallbackReason: { code: 'vulkan_unavailable', detail: 'no device' },
    });
    expect(warned.warnings).toContain('dv_profile_5_colours');
  });

  it('reads a short video as a still and refuses RAW', () => {
    const still = planNormalisation(
      clip({ frameCount: 1, codec: 'hevc' }, { path: '/tmp/IMG_0420.HEIC', container: { formatName: 'heic' } }),
    );
    expect(still.ok && still.value.kind).toBe('image');
    expect(still.ok && still.value.still?.format).toBe('heic');
    const jpeg = planNormalisation(
      clip({ frameCount: 1, codec: 'mjpeg', rotation: 0 }, { path: '/tmp/a.jpg', container: { formatName: 'image2' } }),
    );
    expect(jpeg.ok && jpeg.value.still).toBeUndefined();
    const turned = planNormalisation(
      clip(
        { frameCount: 1, codec: 'mjpeg', rotation: 90, width: 400, height: 300, displayWidth: 300, displayHeight: 400 },
        { path: '/tmp/a.jpg', container: { formatName: 'image2' } },
      ),
    );
    expect(turned.ok && turned.value.still?.format).toBe('jpeg');
    const raw = planNormalisation(probeOf('/tmp/photo.DNG', videoStream({ codec: 'dng', frameCount: 1 })));
    expect(raw.ok).toBe(false);
    if (!raw.ok) expect(raw.error.code).toBe('media.unsupported_media');
  });
});
