// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The grading stage's bakes (P3-V17, round P3-3): one cube per video clip from the GradeLutSource, each asked for
 * as the export job's child, so the queue starts the bake in the slot the export holds; without a source, the
 * Style renders ungraded with a warning, and a failed bake is the stage's error.
 */
import { describe, expect, it } from 'vitest';
import {
  err,
  newId,
  ok,
  styleGradeSchema,
  unwrap,
  ValidationError,
  type AssetId,
  type JobId,
  type StyleGrade,
} from '@taalcut/core';
import { planGrading, type GradingStage } from '../../src/engine/stages/grading';
import { planTimeline } from '../../src/plan/render-plan';
import type { ExportJobRef, GradeLutSource } from '../../src/ports-phase3';
import { makeTimeline } from '../support/timeline';

const grade: StyleGrade = styleGradeSchema.parse({
  version: 1,
  target: {
    version: 1,
    space: 'ruderman-lab',
    encoding: 'bt709',
    mean: [0.1, 0.01, -0.02],
    std: [0.3, 0.05, 0.04],
    frames: 8,
    pixels: 129_600,
  },
  strength: 0.8,
  cubeSize: 33,
  source: { kind: 'template', templateId: newId<'Template'>(), version: 1 },
  measuredAt: 0,
});

function twoClips() {
  const a = newId<'Asset'>();
  const b = newId<'Asset'>();
  const timeline = makeTimeline({
    items: [
      { frames: 30, assetId: a, sourceStart: 0, mediaFrames: 90 },
      { frames: 45, assetId: b, sourceStart: 15, mediaFrames: 90 },
    ],
  });
  return { assets: [a, b], plan: unwrap(planTimeline(timeline)) };
}

function stage(grades: GradeLutSource | undefined, jobId: JobId | null): GradingStage & { stages: string[] } {
  const stages: string[] = [];
  return {
    deps: grades ? { grades } : {},
    record: { jobId },
    signal: new AbortController().signal,
    tracker: { stage: (name) => void stages.push(name), within: () => undefined },
    stages,
  };
}

describe('the grading stage (P3-V17)', () => {
  it("bakes one cube per video clip, each as the export job's child", async () => {
    const { assets, plan } = twoClips();
    const asked: { assetId: AssetId; frames: number; job: ExportJobRef | undefined }[] = [];
    const grades: GradeLutSource = {
      lutFor: async (assetId, range, _grade, _signal, job) => {
        asked.push({ assetId, frames: range.duration.value, job });
        return ok(`/cache/grades/${assetId}.cube`);
      },
    };
    const jobId = newId<'Job'>();
    const context = stage(grades, jobId);
    const planned = unwrap(await planGrading(context, { styled: { style: { grade } }, plan }));
    expect(asked).toEqual([
      { assetId: assets[0], frames: 30, job: { parentJobId: jobId } },
      { assetId: assets[1], frames: 45, job: { parentJobId: jobId } },
    ]);
    expect([...planned.cubes.values()]).toEqual(assets.map((assetId) => `/cache/grades/${assetId}.cube`));
    expect(planned.warnings).toEqual([]);
    expect(context.stages).toEqual(['grading']);
  });

  it('asks without a parent when the render has no job yet', async () => {
    const { plan } = twoClips();
    const jobs: (ExportJobRef | undefined)[] = [];
    const grades: GradeLutSource = {
      lutFor: async (assetId, _range, _grade, _signal, job) => {
        jobs.push(job);
        return ok(`/cache/${assetId}.cube`);
      },
    };
    await planGrading(stage(grades, null), { styled: { style: { grade } }, plan });
    expect(jobs).toEqual([{}, {}]);
  });

  it('renders ungraded with a warning without a source, and stops on a failed bake', async () => {
    const { plan } = twoClips();
    const ungraded = unwrap(
      await planGrading(stage(undefined, null), { styled: { style: { grade } }, plan }),
    );
    expect(ungraded.cubes.size).toBe(0);
    expect(ungraded.warnings).toEqual(['grade not applied: no LUT baker in this process']);
    const failing: GradeLutSource = { lutFor: async () => err(ValidationError({ field: 'grade' })) };
    const failed = await planGrading(stage(failing, newId<'Job'>()), { styled: { style: { grade } }, plan });
    expect(failed.ok ? null : failed.error.code).toBe('core.validation');
  });
});
