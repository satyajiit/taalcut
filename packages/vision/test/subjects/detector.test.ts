// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: the ONNX subject detector with a fake runtime. A 1280 × 720 frame goes to RTMO letterboxed into 640 × 640
 * and to YOLOX-Nano letterboxed into 416 × 416 (both pad 114); one pose (with its face) and one person come back as
 * fractions of the frame, clipped. Sessions open once; a missing file is `vision.model_missing`, any other failure
 * `vision.subject_detect_failed`, and cancellation stays cancellation.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CancelledError, err, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import { afterAll, describe, expect, it } from 'vitest';
import { OcrFailed } from '../../src/errors';
import type { OnnxRuntime, OnnxSession, OnnxTensor } from '../../src/onnx/ort';
import { createOnnxSubjectDetector } from '../../src/subjects/detector';
import {
  SUBJECTS_ONNX_COMPONENT,
  SUBJECTS_OPERATION,
  SUBJECTS_PERSON_FILE,
  SUBJECTS_POSE_FILE,
} from '../../src/subjects/model';

const dir = mkdtempSync(join(tmpdir(), 'taalcut-subjects-'));
writeFileSync(join(dir, SUBJECTS_POSE_FILE), '');
writeFileSync(join(dir, SUBJECTS_PERSON_FILE), '');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const FRAME = { rgb: new Uint8Array(1280 * 720 * 3).fill(200), width: 1280, height: 720 };

/**
 * RTMO's outputs at 0.5 tensor pixels per frame pixel: one person from (100, 20) to (300, 340), facing the camera:
 * nose (200, 60), eyes (190, 55) and (210, 55), ears (180, 60) and (220, 60), shoulders (160, 110) and (240, 110).
 */
function poseOutputs(score: number): Record<string, OnnxTensor> {
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
    dets: { data: Float32Array.from([100, 20, 300, 340, score]), dims: [1, 1, 5] },
    keypoints: { data: keypoints, dims: [1, 1, 17, 3] },
  };
}

/** YOLOX's output for 416: one person on anchor 3438 (stride 32, cell (6, 4)), 4 × 8 strides. */
function personOutput(): OnnxTensor {
  const data = new Float32Array(3549 * 85);
  data.set([0.5, 0.5, Math.log(4), Math.log(8), 0.9, 0.9], 3438 * 85);
  return { data, dims: [1, 3549, 85] };
}

interface Fake {
  readonly runtime: OnnxRuntime;
  readonly opened: { path: string; operation: string }[];
  readonly feeds: Record<string, OnnxTensor>[];
  released: number;
}

function fake(
  options: { failOpen?: boolean; outputs?: string[]; run?: 'fail' | 'cancel'; poseScore?: number } = {},
): Fake {
  const state: Fake = {
    opened: [],
    feeds: [],
    released: 0,
    runtime: {
      openSession(path, { operation }): AsyncResult<OnnxSession> {
        state.opened.push({ path, operation });
        if (options.failOpen) return Promise.resolve(err(OcrFailed(undefined, { detail: 'no device' })));
        const poses = path.endsWith(SUBJECTS_POSE_FILE);
        const session: OnnxSession = {
          backend: 'webgpu',
          inputNames: [poses ? 'input' : 'images'],
          outputNames: poses ? (options.outputs ?? ['dets', 'keypoints']) : ['output'],
          run(feed) {
            state.feeds.push(feed);
            if (options.run === 'fail') return Promise.resolve(err(OcrFailed(undefined, { detail: 'lost' })));
            if (options.run === 'cancel') return Promise.resolve(err(CancelledError()));
            return Promise.resolve(
              ok(poses ? poseOutputs(options.poseScore ?? 0.9) : { output: personOutput() }),
            );
          },
          release: () => {
            state.released += 1;
            return Promise.resolve();
          },
        };
        return Promise.resolve(ok(session));
      },
    },
  };
  return state;
}

const code = (error: TaalcutError) => error.code;

describe('createOnnxSubjectDetector', () => {
  it('feeds each model its tensor and returns poses, faces and people as fractions of the frame', async () => {
    const state = fake();
    const detector = createOnnxSubjectDetector({ runtime: state.runtime, modelDir: dir });
    const result = await detector.detect(FRAME);
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    const [poseFeed, personFeed] = state.feeds;
    expect(poseFeed!.input!.dims).toEqual([1, 3, 640, 640]);
    // The frame fills the top 360 rows at half size; the rest is the pad.
    expect(poseFeed!.input!.data[0]).toBe(200);
    expect(poseFeed!.input!.data[400 * 640]).toBe(114);
    expect(personFeed!.images!.dims).toEqual([1, 3, 416, 416]);
    expect(personFeed!.images!.data[0]).toBe(200);
    expect(personFeed!.images!.data[300 * 416]).toBe(114);

    const poses = result.value.poses ?? [];
    expect(poses).toHaveLength(1);
    expect(poses[0]!.confidence).toBeCloseTo(0.9);
    expect(poses[0]!.box.x).toBeCloseTo(200 / 1280);
    expect(poses[0]!.box.y).toBeCloseTo(40 / 720);
    expect(poses[0]!.keypoints[3]).toEqual({ x: 360 / 1280, y: 120 / 720, score: expect.closeTo(0.9, 5) });

    // The face: centred on the nose and eyes, inside the pose's head.
    expect(result.value.faces).toHaveLength(1);
    const face = result.value.faces[0]!;
    expect(face.box.x + face.box.width / 2).toBeCloseTo(400 / 1280);
    expect(face.box.y + face.box.height / 2).toBeCloseTo((((55 + 55 + 60) / 3) * 2) / 720);

    // 128 × 256 tensor pixels from (144, 16) at 416 / 1280: past the frame's foot, so clipped.
    expect(result.value.people).toHaveLength(1);
    const person = result.value.people[0]!;
    expect(person.confidence).toBeCloseTo(0.81);
    expect(person.box.x).toBeCloseTo(144 / 416);
    expect(person.box.y).toBeCloseTo(16 / 234);
    expect(person.box.width).toBeCloseTo(128 / 416);
    expect(person.box.y + person.box.height).toBeCloseTo(1);
    expect(detector.backends()).toEqual({ poses: 'webgpu', people: 'webgpu' });
  });

  it('opens both sessions once, by their operations, and releases them', async () => {
    const state = fake();
    const detector = createOnnxSubjectDetector({ runtime: state.runtime, modelDir: dir });
    await detector.detect(FRAME);
    await detector.detect(FRAME);
    expect(state.opened).toEqual([
      { path: join(dir, SUBJECTS_POSE_FILE), operation: SUBJECTS_OPERATION.poses },
      { path: join(dir, SUBJECTS_PERSON_FILE), operation: SUBJECTS_OPERATION.people },
    ]);
    await detector.release();
    expect(state.released).toBe(2);
    expect(detector.backends()).toEqual({});
  });

  it('applies tuning overrides', async () => {
    const state = fake({ poseScore: 0.85 });
    const detector = createOnnxSubjectDetector({
      runtime: state.runtime,
      modelDir: dir,
      tuning: { poseScore: 0.9 },
    });
    const result = await detector.detect(FRAME);
    expect(result.ok && result.value.poses).toEqual([]);
    expect(result.ok && result.value.faces).toEqual([]);
  });

  it('names the component when a model file is missing, without opening anything', async () => {
    const state = fake();
    const empty = mkdtempSync(join(tmpdir(), 'taalcut-subjects-empty-'));
    const detector = createOnnxSubjectDetector({ runtime: state.runtime, modelDir: empty });
    const result = await detector.detect(FRAME);
    rmSync(empty, { recursive: true, force: true });
    expect(!result.ok && result.error).toMatchObject({
      code: 'vision.model_missing',
      params: { component: SUBJECTS_ONNX_COMPONENT },
    });
    expect(state.opened).toEqual([]);
  });

  it('fails a session that will not open, and tries again on the next call', async () => {
    const state = fake({ failOpen: true });
    const detector = createOnnxSubjectDetector({ runtime: state.runtime, modelDir: dir });
    const first = await detector.detect(FRAME);
    const second = await detector.detect(FRAME);
    expect(!first.ok && code(first.error)).toBe('vision.subject_detect_failed');
    expect(!second.ok && code(second.error)).toBe('vision.subject_detect_failed');
    expect(state.opened).toHaveLength(2);
  });

  it('refuses a graph without the expected outputs and releases it', async () => {
    const state = fake({ outputs: ['boxes'] });
    const detector = createOnnxSubjectDetector({ runtime: state.runtime, modelDir: dir });
    const result = await detector.detect(FRAME);
    expect(!result.ok && result.error.detail).toContain('unexpected graph');
    expect(state.released).toBe(1);
  });

  it('fails a run, keeps cancellation, and checks the frame', async () => {
    const failing = createOnnxSubjectDetector({ runtime: fake({ run: 'fail' }).runtime, modelDir: dir });
    const failed = await failing.detect(FRAME);
    expect(!failed.ok && code(failed.error)).toBe('vision.subject_detect_failed');

    const cancelling = createOnnxSubjectDetector({ runtime: fake({ run: 'cancel' }).runtime, modelDir: dir });
    const cancelled = await cancelling.detect(FRAME);
    expect(!cancelled.ok && code(cancelled.error)).toBe('core.cancelled');

    const state = fake();
    const detector = createOnnxSubjectDetector({ runtime: state.runtime, modelDir: dir });
    const aborted = await detector.detect(FRAME, AbortSignal.abort());
    expect(!aborted.ok && code(aborted.error)).toBe('core.cancelled');
    const short = await detector.detect({ rgb: new Uint8Array(10), width: 4, height: 4 });
    expect(!short.ok && code(short.error)).toBe('vision.subject_detect_failed');
    expect(state.opened).toEqual([]);
  });
});
