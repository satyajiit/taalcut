// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  createDirectJobRunner,
  lookStatsSchema,
  ok,
  type AssetId,
  type ComputeFallbackEvent,
  type DerivedFileRef,
  type TimeRange,
  unwrap,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { parseCube } from '../../src/look/cube-writer';
import { GradeFailed, LookUnavailable } from '../../src/look/errors';
import {
  createLookJobs,
  visionBakeGradeJob,
  visionMeasureLookJob,
  type GradeLutSink,
  type LookFrameSource,
} from '../../src/look/grade-jobs';
import { measureLook, type LookFrame } from '../../src/look/look-stats';

const assetId = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as AssetId;
const range: TimeRange = {
  start: { value: 0, rate: { num: 24, den: 1 } },
  duration: { value: 48, rate: { num: 24, den: 1 } },
};

function varied(seed: number): LookFrame {
  const width = 8;
  const height = 8;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = (seed + i * 3) % 180;
    rgb[i * 3 + 1] = (seed / 2 + i) % 140;
    rgb[i * 3 + 2] = (40 + i * 5) % 200;
  }
  return { width, height, rgb, encoding: 'bt709' };
}

describe('look jobs', () => {
  it('measures a look, bakes a cube, and records the CPU path once per job kind', async () => {
    const events: ComputeFallbackEvent[] = [];
    let cube = '';
    const frames: LookFrameSource = {
      async sample() {
        return ok([varied(90)]);
      },
    };
    const luts: GradeLutSink = {
      async write(_assetId, cubeText, key) {
        cube = cubeText;
        const ref: DerivedFileRef = {
          kind: 'gradeLut',
          key,
          bytes: cubeText.length,
          mimeType: 'text/plain',
          recipe: 1,
        };
        return ok(ref);
      },
    };
    const jobs = createLookJobs({ frames, luts, onFallback: (event) => events.push(event) });
    const runner = createDirectJobRunner(jobs);
    const measured = await runner.run(visionMeasureLookJob, { assetId, range });
    expect(measured.ok).toBe(true);
    if (!measured.ok) return;
    expect(lookStatsSchema.safeParse(measured.value.look).success).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]?.operation).toBe('vision.measureLook');
    expect(events[0]?.reason).toBe('no_accelerator');
    expect(events[0]?.wanted).toEqual(['metal']);

    const baked = await runner.run(visionBakeGradeJob, {
      assetId,
      range,
      target: unwrap(measureLook([varied(20)])),
      strength: 0.75,
      cubeSize: 17,
    });
    expect(baked.ok).toBe(true);
    if (!baked.ok) return;
    expect(baked.value.lut.kind).toBe('gradeLut');
    expect(baked.value.lut.key).toMatch(/^grades\/[0-9a-f]{2}\/[0-9a-f]{64}\.v1\.cube$/);
    const parsed = parseCube(cube);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.size).toBe(17);
    expect(events).toHaveLength(2);
    expect(events[1]?.operation).toBe('vision.bakeGrade');
    expect(events[1]?.reason).toBe('no_accelerator');
    expect((await runner.run(visionMeasureLookJob, { assetId, range })).ok).toBe(true);
    expect(events).toHaveLength(2);

    const again = visionBakeGradeJob.idempotencyKey?.({
      assetId,
      range,
      target: measured.value.look,
      strength: 0.75,
      cubeSize: 17,
    });
    const other = visionBakeGradeJob.idempotencyKey?.({
      assetId,
      range,
      target: measured.value.look,
      strength: 1,
      cubeSize: 17,
    });
    expect(again).toBeTruthy();
    expect(again).not.toBe(other);
  });

  it('does not record a fallback when a test injects Metal, and still measures on the CPU', async () => {
    const events: ComputeFallbackEvent[] = [];
    const frames: LookFrameSource = {
      async sample() {
        return ok([varied(12)]);
      },
    };
    const luts: GradeLutSink = {
      async write() {
        return ok({
          kind: 'gradeLut',
          key: 'grades/ab/' + 'a'.repeat(64) + '.v1.cube',
          bytes: 1,
          mimeType: 'text/plain',
          recipe: 1,
        });
      },
    };
    const runner = createDirectJobRunner(
      createLookJobs({
        frames,
        luts,
        onFallback: (event) => events.push(event),
        available: ['metal', 'cpu'],
      }),
    );
    const measured = await runner.run(visionMeasureLookJob, { assetId, range });
    expect(measured.ok).toBe(true);
    expect(events).toHaveLength(0);
  });

  it('returns LookUnavailable when the clip has no usable frame', async () => {
    const frames: LookFrameSource = {
      async sample() {
        return ok([]);
      },
    };
    const luts: GradeLutSink = {
      async write() {
        throw new Error('sink should not be called');
      },
    };
    const runner = createDirectJobRunner(createLookJobs({ frames, luts }));
    const measured = await runner.run(visionMeasureLookJob, { assetId, range });
    expect(measured.ok).toBe(false);
    if (!measured.ok) expect(LookUnavailable.is(measured.error)).toBe(true);
    expect(GradeFailed().retryable).toBe(true);
    expect(LookUnavailable().retryable).toBe(false);
  });
});
