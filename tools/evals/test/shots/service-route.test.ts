// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-R1: `predict:shots` decodes where the app does. Where the decode switch gives the analysis pass to the decode
 * service, each clip goes through vision's shots job with the service, the app's OCR engine (the job keeps the OCR
 * frames only with one) and the detector's model; elsewhere there is no route and `detectShots` runs FFmpeg's pass.
 */
import { err, ok, registerJob, type JobContext } from '@taalcut/core';
import {
  DECODE_SERVICE_ENV,
  SidecarNotFound,
  type DecodeService,
  type MediaContext,
  type SidecarResolver,
} from '@taalcut/media';
import { visionDetectShotsJob, type VisionJobDeps } from '@taalcut/vision';
import { describe, expect, it } from 'vitest';
import { openShotsRoute, recordingPasses } from '../../src/shots/service-route';

const helper: SidecarResolver = {
  resolve: async () => ok({ path: '/helpers/taalcut-mac-helper', source: 'env' as const }),
};
const noHelper: SidecarResolver = {
  resolve: async () => err(SidecarNotFound({ binary: 'taalcut-mac-helper' })),
};
const media: MediaContext = { binaries: { ffmpeg: '/ffmpeg', ffprobe: '/ffprobe', source: 'env' } };
const frameRate = { num: 30, den: 1 };

/** A shots job that records the deps it was made with and the input it ran on. */
function fakeJobs(seen: { deps?: VisionJobDeps; input?: unknown }) {
  return (deps: VisionJobDeps) => {
    seen.deps = deps;
    return [
      registerJob(visionDetectShotsJob, async (input, context: JobContext) => {
        seen.input = input;
        context.progress({ fraction: 0.8 });
        context.progress({ fraction: null });
        context.progress({ fraction: 1 });
        return ok({
          detector: 'model' as const,
          frameRate,
          frameCount: 90,
          shots: [],
          cuts: [{ frame: 42, score: 0.97, method: 'model' as const, kind: 'cut' as const }],
        });
      }),
    ];
  };
}

describe('openShotsRoute', () => {
  it('opens none where the switch leaves the pass to FFmpeg: frames, off, or no helper', async () => {
    const lines: string[] = [];
    const open = (value: string, resolver = helper) =>
      openShotsRoute({
        footageDir: '/footage',
        decode: { env: { [DECODE_SERVICE_ENV]: value }, resolver, log: (line) => lines.push(line) },
        log: (line) => lines.push(line),
      });
    expect(await open('frames')).toBeUndefined();
    expect(await open('off')).toBeUndefined();
    expect(await open('mac-helper', noHelper)).toBeUndefined();
    expect(lines).toEqual([
      'analysis pass on FFmpeg',
      'analysis pass on FFmpeg',
      '[media] decode service: no mac helper (media.sidecar_not_found); FFmpeg decodes',
      'analysis pass on FFmpeg',
    ]);
  });

  it('runs a clip through the shots job with the service, the OCR engine and the detector', async () => {
    const seen: { deps?: VisionJobDeps; input?: unknown } = {};
    const lines: string[] = [];
    const route = await openShotsRoute({
      footageDir: '/footage',
      decode: { env: { [DECODE_SERVICE_ENV]: 'mac-helper' }, resolver: helper },
      jobs: fakeJobs(seen),
      log: (line) => lines.push(line),
    });
    if (!route) throw new Error('the switch named the pass, and a helper resolved: a route was expected');
    expect(route.took).toBe('pass and frames');
    expect(lines).toEqual(['analysis pass on the decode service (it takes pass and frames)']);
    const boundaryModel = async () => err(SidecarNotFound({ binary: 'transnetv2' }));
    const progress: number[] = [];
    const found = await route.detect(
      '/footage/clip.mov',
      { media, boundaryModel, keepOcrFrames: true },
      { progress: (fraction) => progress.push(fraction) },
    );
    await route.close();
    expect(found).toEqual(
      ok({ detector: 'model', cuts: [{ frame: 42, score: 0.97, method: 'model', kind: 'cut' }] }),
    );
    expect(seen.input).toMatchObject({ path: '/footage/clip.mov' });
    expect(seen.deps?.decodeService?.tasks).toEqual(['pass', 'frames']);
    expect(seen.deps?.ocr).toBeDefined();
    expect(seen.deps?.boundaryModel).toBe(boundaryModel);
    expect(seen.deps?.media).toBe(media);
    // The job's marks reach the timer; a mark without a fraction doesn't.
    expect(progress).toEqual([0.8, 1]);
    // No pass reached the service here (the job is a fake): the clip's pass is FFmpeg's.
    expect(route.passOf('/footage/clip.mov')).toBe('FFmpeg');
  });
});

describe('recordingPasses', () => {
  it('keeps each file’s last pass: decoded by the service, or declined (FFmpeg then decodes it)', async () => {
    const declined = new Set(['/footage/hdr.mov']);
    const service: DecodeService = {
      id: 'fake',
      tasks: ['pass'],
      pass: async (request) =>
        declined.has(request.path)
          ? err(SidecarNotFound({ binary: 'decode.unsupported' }))
          : ok({ frames: 30, sets: [], ms: 5 }),
      frames: async () => err(SidecarNotFound({ binary: 'none' })),
      avoid: () => {},
      avoided: () => undefined,
      close: async () => {},
    };
    const outcomes = new Map<string, boolean>();
    const recorded = recordingPasses(service, outcomes);
    const request = (path: string) => ({
      path,
      rate: frameRate,
      rotation: 0 as const,
      range: 'video' as const,
      analysis: { width: 256, height: 144, path: '/tmp/fifo' },
      sets: [],
    });
    await recorded.pass(request('/footage/clip.mov'));
    await recorded.pass(request('/footage/hdr.mov'));
    expect([...outcomes]).toEqual([
      ['/footage/clip.mov', true],
      ['/footage/hdr.mov', false],
    ]);
    expect(recorded.tasks).toEqual(['pass']);
  });
});
