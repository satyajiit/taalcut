// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * stylePacing (LRN1-STY): a render made like a set of references keeps its median shot inside the set's band
 * (the quartiles widened by 10%). Outside, it fails overridably with the Editor's way back; without shots or a
 * followed set it is skipped. The band comes from the engine's `stylePacing` port at gathering, and the shots are
 * the enabled V1 clips outside the Style's bumpers.
 */
import { join } from 'node:path';
import { ok, unwrap, type ProjectId, type StyleBand } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gatherExport } from '../../src/engine/export-inputs';
import {
  STYLE_PACING_SLACK,
  stylePacingCheck,
  stylePacingLimits,
  stylePacingShots,
  type StylePacingShot,
} from '../../src/qa/checks/style-pacing';
import { QA_MODULES } from '../../src/qa/modules';
import { checkMeta } from '../../src/qa/result';
import { renderRow } from '../commands/support';
import { testEngine } from '../support/engine';
import { tempDir } from '../support/media';
import { makeTimeline } from '../support/timeline';
import { qaPlan, runInput } from './support';

const RATE = { num: 30, den: 1 };
const BAND: StyleBand = { n: 12, q1: 0.8, median: 1, q3: 1.2 };
/** Shots of these many frames at 30 fps, back to back. */
function shots(...frames: number[]): StylePacingShot[] {
  let start = 0;
  return frames.map((length, index) => {
    const span = { start, end: start + length };
    start += length;
    return { id: `clip${index + 1}`, span };
  });
}

describe('stylePacing', () => {
  it('is a style check the user may override, and runs as a module', () => {
    expect(checkMeta('stylePacing')).toMatchObject({ group: 'style', preflight: false, overridable: true });
    expect(QA_MODULES.some((module) => module.ids.includes('stylePacing'))).toBe(true);
    expect(STYLE_PACING_SLACK).toBe(0.1);
    expect(stylePacingLimits(BAND)).toEqual({ min: 0.72, max: 1.32 });
  });

  it("passes a render whose median shot sits in the set's band", () => {
    const result = stylePacingCheck({ band: BAND, shots: shots(24, 30, 36, 90), rate: RATE });
    expect(result).toMatchObject({
      status: 'pass',
      measured: { value: 1.1, unit: 'seconds' },
      threshold: { min: 0.72, max: 1.32, unit: 'seconds' },
      fixes: [],
    });
  });

  it('fails a render cut faster than the set, naming the shortest shots and asking for longer ones', () => {
    const result = stylePacingCheck({ band: BAND, shots: shots(12, 15, 18, 60), rate: RATE });
    expect(result).toMatchObject({ status: 'fail', overridable: true, measured: { value: 0.55 } });
    expect(result.findings.map((finding) => finding.target?.id)).toEqual(['clip1', 'clip2', 'clip3']);
    expect(result.findings[0]).toMatchObject({
      frames: { start: 0, end: 12 },
      measured: { value: 0.4, unit: 'seconds' },
    });
    expect(result.fixes).toEqual([
      {
        kind: 'agent',
        instructionKey: 'qa.fixes.matchStylePacing',
        params: { direction: 'longer', renderMedianMs: 550, q1Ms: 800, medianMs: 1000, q3Ms: 1200, shots: 3 },
      },
    ]);
  });

  it('fails a render slower than the set, longest shots first', () => {
    const result = stylePacingCheck({ band: BAND, shots: shots(90, 60, 75, 20), rate: RATE });
    expect(result.status).toBe('fail');
    expect(result.findings.map((finding) => finding.target?.id)).toEqual(['clip1', 'clip3', 'clip2']);
    expect(result.fixes[0]).toMatchObject({ params: { direction: 'shorter', renderMedianMs: 2250 } });
  });

  it('is skipped without shots, and when the project follows no set', async () => {
    expect(stylePacingCheck({ band: BAND, shots: [], rate: RATE }).status).toBe('skipped');
    const module = QA_MODULES.find((candidate) => candidate.ids.includes('stylePacing'));
    const run = runInput('/no/file.mp4', qaPlan());
    const probed = null;
    expect(await module?.run({ run, facts: {}, probed }, new Set(['stylePacing']))).toMatchObject([
      { id: 'stylePacing', status: 'skipped' },
    ]);
    expect(await module?.run({ run, facts: {}, probed }, new Set(['loudness']))).toEqual([]);
  });

  it("counts enabled V1 clips outside the Style's intro and outro", () => {
    const visual = (id: string, start: number, end: number, enabled = true) => ({
      id,
      cut: { start, end },
      enabled,
    });
    const planned = {
      visuals: [
        visual('intro', 0, 30),
        visual('a', 30, 60),
        visual('off', 60, 90, false),
        visual('b', 90, 120),
        visual('outro', 120, 150),
      ],
      bumpers: { intro: { start: 0, end: 30 }, outro: { start: 120, end: 150 } },
    };
    expect(stylePacingShots(planned).map((shot) => shot.id)).toEqual(['a', 'b']);
  });
});

describe('stylePacing at gathering', () => {
  let work: Awaited<ReturnType<typeof tempDir>>;
  beforeEach(async () => {
    work = await tempDir('style-pacing');
  });
  afterEach(() => work.dispose());

  it("reads the band of the set the render's project follows, and the gate holds the render to it", async () => {
    const timeline = makeTimeline({ items: [{ frames: 30 }, { frames: 30 }, { frames: 36 }] });
    const asked: ProjectId[] = [];
    const gather = async (band: StyleBand | null) => {
      const engine = testEngine(join(work.dir, String(asked.length)), {} as MediaContext, '/no-shell', {
        stylePacing: async (projectId) => (asked.push(projectId), ok(band)),
      });
      engine.timelines.set(timeline.id, timeline);
      const record = renderRow({
        projectId: timeline.projectId,
        timelineId: timeline.id,
        durationFrames: 96,
      });
      return unwrap(await gatherExport(engine.deps, record));
    };

    const like = await gather(BAND);
    expect(asked).toEqual([timeline.projectId]);
    expect(like.stylePacing).toEqual(BAND);
    const fact = { band: BAND, shots: stylePacingShots(like.plan) };
    expect(stylePacingCheck({ ...fact, rate: RATE }).status).toBe('pass');
    const slower = { n: 12, q1: 2, median: 2.5, q3: 3 };
    expect(stylePacingCheck({ ...fact, band: slower, rate: RATE }).status).toBe('fail');

    expect((await gather(null)).stylePacing).toBeUndefined();
  });
});
