// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A FrameSource with no FFmpeg: frames are made by a function of the index
 * (gray frame k is filled with k), the pass streams them and returns the
 * scores it was given, and documents live in a map. Counts what was asked.
 */
import { FrameRate, ok } from '@taalcut/core';
import {
  NO_DECODES,
  planNormalisation,
  type NormalisationPlan,
  type ProbeResult,
  type VideoStreamInfo,
} from '@taalcut/media';
import type { FrameRequest, FrameSource, PassRequest, PassResult } from '../../src/media/frame-source';
import type { SampledFrame } from '../../src/media/frames';

export interface FakeSourceOptions {
  readonly frames?: number;
  readonly width?: number;
  readonly height?: number;
  /** The pass's scores and intervals; frames fill in from `pixel`. */
  readonly pass?: Partial<PassResult>;
  /** Gray value of pixel i of frame k. Default: k. */
  readonly pixel?: (frame: number, i: number) => number;
  /** Decode in these segments (frames from `from`, owning [start, end)), interleaved frame by frame. */
  readonly segments?: readonly { readonly start: number; readonly end: number; readonly from: number }[];
}

export interface FakeFrameSource extends FrameSource {
  readonly passes: PassRequest[];
  readonly requests: FrameRequest[];
  readonly docs: Map<string, unknown>;
  readonly released: string[];
  readonly expected: string[];
}

/** An 8-bit SDR H.264 30 fps plan for this Mac's VideoToolbox (no FFmpeg). */
export function fakeVideoPlan(frames: number, width: number, height: number): NormalisationPlan {
  const video: VideoStreamInfo = {
    kind: 'video',
    index: 0,
    tags: {},
    codec: 'h264',
    profile: 'High',
    width,
    height,
    displayWidth: width,
    displayHeight: height,
    rotation: 0,
    pixelFormat: 'yuv420p',
    bitDepth: 8,
    colour: {},
    isHdr: false,
    hdrFormats: [],
    vfrHint: false,
    isAttachedPicture: false,
    frameRate: { num: 30, den: 1 },
    averageFrameRate: { num: 30, den: 1 },
    duration: { value: frames, rate: 30 },
    frameCount: frames,
  };
  const probe: ProbeResult = {
    path: '/clips/fake.mp4',
    container: { formatName: 'mov,mp4,m4a,3gp,3g2,mj2' },
    streams: [video],
    video,
    chapters: [],
    tags: {},
  };
  const planned = planNormalisation(probe, { platform: 'darwin' });
  if (!planned.ok) throw new Error(planned.error.code);
  return planned.value;
}

export function fakeFrameSource(options: FakeSourceOptions = {}): FakeFrameSource {
  const count = options.frames ?? 90;
  const width = options.width ?? 320;
  const height = options.height ?? 180;
  const pixel = options.pixel ?? ((frame: number) => frame);
  const gray = (index: number, w: number, h: number) =>
    Uint8Array.from({ length: w * h }, (_, i) => pixel(index, i) & 0xff);
  const source: FakeFrameSource = {
    passes: [],
    requests: [],
    docs: new Map(),
    released: [],
    expected: [],
    video: {
      path: '/clips/fake.mp4',
      width,
      height,
      rate: FrameRate.of(30),
      frameCount: count,
      plan: fakeVideoPlan(count, width, height),
    },
    input: 'original',
    async frames(request) {
      source.requests.push(request);
      const size = 'longSide' in request.size ? { width: 64, height: 36 } : request.size;
      const channels = request.format === 'rgb24' ? 3 : 1;
      const out: SampledFrame[] = request.frames
        .filter((index) => index < count)
        .sort((a, b) => a - b)
        .map((index) => ({ index, ...size, data: gray(index, size.width * channels, size.height) }));
      return ok(out);
    },
    async prefetch(requests) {
      source.requests.push(...requests);
      return ok(undefined);
    },
    async pass(request) {
      source.passes.push(request);
      const w = Math.round((width / Math.max(width, height)) * request.longSide);
      const h = Math.round((height / Math.max(width, height)) * request.longSide);
      const segments = options.segments ?? [{ start: 0, end: count, from: 0 }];
      const cursors = segments.map((s) => s.from);
      for (let more = true; more;) {
        more = false;
        segments.forEach((segment, i) => {
          const index = cursors[i] ?? segment.end;
          if (index >= segment.end) return;
          request.onFrame?.({ index, width: w, height: h, data: gray(index, w, h) }, i);
          cursors[i] = index + 1;
          more = true;
        });
      }
      return ok({
        fine: options.pass?.fine ?? [],
        coarse: options.pass?.coarse ?? [],
        black: options.pass?.black ?? [],
        freeze: options.pass?.freeze ?? [],
        frames: count,
        segments: segments.map(({ start, end }) => ({ start, end })),
      });
    },
    async putDoc(name, value) {
      source.docs.set(name, JSON.parse(JSON.stringify(value)));
      return ok(true);
    },
    async getDoc(name) {
      return ok(source.docs.get(name));
    },
    expect: (consumers) => void source.expected.push(...consumers),
    async release(consumer) {
      source.released.push(consumer);
    },
    decodes: () => NO_DECODES,
    async close() {},
  };
  return source;
}
