// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: `render.trackSubjects` without the mac helper. Each platform's tracks have their own recipe (the helper's
 * on a Mac); the ONNX tracker turns a shot into a SubjectTrack of detect samples with heads, lets go once whatever
 * happens, and says when the model component can't be had. A synthetic clip and a fake ONNX runtime (one person
 * facing the camera on every frame); skipped without FFmpeg.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  defineError,
  err,
  FrameRate,
  newId,
  ok,
  RationalTime,
  TimeRange,
  type AsyncResult,
} from '@taalcut/core';
import { ONNX_TRACK_RECIPE, TRACK_RECIPE } from '@taalcut/render';
import {
  SUBJECTS_PERSON_FILE,
  SUBJECTS_POSE_FILE,
  type OnnxRuntime,
  type OnnxSession,
} from '@taalcut/vision';
import { hostPlatform } from '../src/platform';
import { subjectRecipe } from '../src/utility/roots/render-subject-recipe';
import { onnxTracker } from '../src/utility/roots/render-subjects-onnx';
import { testFfmpeg } from './helpers/test-ffmpeg';

const NotInstalled = defineError('test.not_installed', { retryable: false });

/** One person from (100, 20) to (300, 340) of the 640 tensor, ears, eyes, nose and shoulders seen. */
function fakeRuntime(): OnnxRuntime {
  const keypoints = new Float32Array(17 * 3);
  const set = (index: number, x: number, y: number) => keypoints.set([x, y, 0.9], index * 3);
  set(0, 200, 60);
  set(1, 190, 55);
  set(2, 210, 55);
  set(3, 180, 60);
  set(4, 220, 60);
  set(5, 160, 110);
  set(6, 240, 110);
  return {
    openSession(path): AsyncResult<OnnxSession> {
      const pose = path.endsWith(SUBJECTS_POSE_FILE);
      const outputs: Record<string, { data: Float32Array; dims: number[] }> = pose
        ? {
            dets: { data: Float32Array.from([100, 20, 300, 340, 0.9]), dims: [1, 1, 5] },
            keypoints: { data: keypoints, dims: [1, 1, 17, 3] },
          }
        : { output: { data: new Float32Array(3549 * 85), dims: [1, 3549, 85] } };
      return Promise.resolve(
        ok({
          backend: 'cpu',
          inputNames: ['input'],
          outputNames: Object.keys(outputs),
          run: () => Promise.resolve(ok(outputs)),
          release: () => Promise.resolve(),
        }),
      );
    },
  };
}

const rate = FrameRate.of(30, 1);
const input = (path: string, onLetGo: () => void) => ({
  assetId: newId<'Asset'>(),
  contentHash: 'c'.repeat(64),
  path,
  range: TimeRange.of(RationalTime.of(15, rate), RationalTime.of(30, rate)),
  onLetGo,
});

describe('subject tracks without the mac helper (FRM1-SUB)', () => {
  it('keys each platform’s tracks by its own recipe', () => {
    expect(subjectRecipe(hostPlatform('darwin').abilities)).toBe(TRACK_RECIPE);
    expect(subjectRecipe(hostPlatform('linux').abilities)).toBe(ONNX_TRACK_RECIPE);
    expect(subjectRecipe(hostPlatform('win32').abilities)).toBe(ONNX_TRACK_RECIPE);
  });

  it('lets go and fails when the model component can’t be had', async () => {
    let letGo = 0;
    const tracker = onnxTracker({
      media: () => Promise.resolve(err(NotInstalled())),
      modelDir: () => Promise.resolve(err(NotInstalled())),
      runtime: fakeRuntime,
    });
    const tracked = await tracker.track(input('/library/a.mp4', () => void letGo++));
    expect(!tracked.ok && tracked.error.code).toBe('test.not_installed');
    expect(letGo).toBe(1);
  });
});

const resolved = await testFfmpeg('onnx tracker');
const dir = mkdtempSync(join(tmpdir(), 'taalcut-onnx-tracker-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!resolved.ok)('the ONNX tracker on a clip', () => {
  it('makes a track of detect samples with heads, at the ONNX recipe', { timeout: 60_000 }, async () => {
    const binaries = resolved.ok ? resolved.value : (undefined as never);
    const clip = join(dir, 'clip.mp4');
    const made = spawnSync(binaries.ffmpeg, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=30:duration=2',
      '-pix_fmt',
      'yuv420p',
      clip,
    ]);
    expect(made.status).toBe(0);
    const models = join(dir, 'models');
    spawnSync('mkdir', ['-p', models]);
    writeFileSync(join(models, SUBJECTS_POSE_FILE), '');
    writeFileSync(join(models, SUBJECTS_PERSON_FILE), '');
    let letGo = 0;
    const tracker = onnxTracker({
      media: () => Promise.resolve(ok({ binaries })),
      modelDir: () => Promise.resolve(ok(models)),
      runtime: fakeRuntime,
    });
    const tracked = await tracker.track(input(clip, () => void letGo++));
    if (!tracked.ok) throw new Error(JSON.stringify(tracked.error));
    const track = tracked.value.track;
    expect(letGo).toBe(1);
    expect(track.recipe).toEqual(ONNX_TRACK_RECIPE);
    // A clip smaller than the recipe's short side is read at its own size.
    expect(track.frame).toEqual({ width: 640, height: 360 });
    // 0.5 s to 1.5 s at 4 a second.
    expect(track.samples.map((sample) => sample.t.value)).toEqual([15, 23, 30, 38]);
    for (const sample of track.samples) {
      expect(sample.source).toBe('detect');
      expect(sample.heads).toHaveLength(1);
      expect(sample.faces).toHaveLength(1);
      expect(sample.subject.kind).toBe('face');
    }
  });
});
