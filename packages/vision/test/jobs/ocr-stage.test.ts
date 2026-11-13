// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The vision.ocr stage (IX-O5): when it reads, what it asks for, and how its text lands in stored analyses. */
import {
  FrameRate,
  newId,
  RationalTime,
  TimeRange,
  type AssetIndexView,
  type IndexStageDefinition,
  type ShotAnalysis,
  type ShotId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { VISION_CONFIG } from '../../src/config';
import { createVisionIndexStages } from '../../src/jobs/stages';
import { createOcrMeter } from '../../src/ocr/meter';
import { fakeAnalysis, fakeText } from '../helpers/shot-analysis';

const RATE = FrameRate.of(30);
const range = (start: number, frames: number) =>
  TimeRange.of(RationalTime.of(start, RATE), RationalTime.of(frames, RATE));

const analysis = (over: Partial<ShotAnalysis> = {}) => fakeAnalysis(range(0, 90), over);
const text = (value: string, start = 30) => fakeText(value, range(start, 31));

const A = newId<'Shot'>() as ShotId;
const B = newId<'Shot'>() as ShotId;

function view(over: Partial<AssetIndexView> = {}): AssetIndexView {
  return {
    assetId: newId<'Asset'>(),
    generation: 1,
    kind: 'video',
    path: '/clips/a.mov',
    contentHash: 'ab'.repeat(32),
    sizeBytes: 1,
    sourceId: newId<'Source'>(),
    capturedAt: null,
    facts: null,
    derived: [],
    shots: [
      { shotId: A, range: range(0, 90), analysis: analysis() },
      { shotId: B, range: range(90, 20), analysis: analysis({ range: range(90, 20), bestFrame: 7 }) },
    ],
    transcript: null,
    outputs: { 'vision.analyse': { shots: [], text: 'vision.ocr' } },
    ...over,
  };
}

function stages(spoken?: string) {
  const all = createVisionIndexStages({
    tier: 'recommended',
    ocrLanguages: () => ['en', 'es'],
    placement: () => 'local',
    ...(spoken ? { spokenLanguage: () => spoken } : {}),
  });
  const named = (name: string): IndexStageDefinition => {
    const stage = all.find((s) => s.stage === name);
    if (!stage) throw new Error(`no ${name}`);
    return stage;
  };
  return { ocr: named('vision.ocr'), analyse: named('vision.analyse'), shots: named('vision.shots'), all };
}

/** The job a stage builds, or its skip key. */
function jobOf(stage: IndexStageDefinition, v: AssetIndexView) {
  const job = stage.job(v);
  if ('skip' in job) return { skip: job.skip };
  return { kind: job.kind.kind, input: job.input };
}

describe('vision.ocr: when it reads', () => {
  it('runs after the analysis and the spoken language when it can come, as a searchable stage at normal priority', () => {
    const { ocr, all } = stages();
    expect(ocr.needs).toEqual(['vision.shots', 'vision.analyse']);
    // The language only routes Devanagari: never waited for while whisper is missing (LRN1-CTX).
    expect(ocr.optionalReads).toEqual(['audio.language']);
    expect([ocr.priority, ocr.milestone]).toEqual(['normal', 'searchable']);
    expect(all.map((s) => s.stage).indexOf('vision.ocr')).toBe(
      all.map((s) => s.stage).indexOf('vision.analyse') + 1,
    );
  });

  it('holds back only its own vectors: vision.embedOcr waits for it, the frame vectors never do', () => {
    const byName = (name: string) => stages().all.find((s) => s.stage === name);
    expect(byName('vision.embed')?.needs).not.toContain('vision.ocr');
    expect(byName('vision.embedOcr')?.needs).toEqual(['vision.ocr']);
  });

  it('reads every analysed shot, the spoken language first, with each shot’s best frame', () => {
    const job = jobOf(stages('hi').ocr, view());
    expect(job.kind).toBe('vision.readShotText');
    expect(job.input).toMatchObject({
      languages: ['hi', 'en', 'es'],
      shots: [
        { shotId: A, bestFrame: 12 },
        { shotId: B, bestFrame: 7 },
      ],
    });
    expect(jobOf(stages().ocr, view()).input).toMatchObject({ languages: ['en', 'es'] });
    expect(jobOf(stages('en').ocr, view()).input).toMatchObject({ languages: ['en', 'es'] });
  });

  it('names the asset’s source and the text tracks each shot holds, for a run with no engine (IX2-F12)', () => {
    const v = view({
      shots: [
        { shotId: A, range: range(0, 90), analysis: analysis({ onScreenText: [text('SALE'), text('50%')] }) },
        { shotId: B, range: range(90, 20), analysis: analysis({ range: range(90, 20) }) },
      ],
    });
    const job = jobOf(stages().ocr, v);
    expect(job.input).toMatchObject({
      sourceId: v.sourceId,
      shots: [{ shotId: A, textTracks: 2 }, { shotId: B }],
    });
    const shots = (job.input as { shots: { textTracks?: number }[] }).shots;
    expect(shots[1]).not.toHaveProperty('textTracks');
  });

  it('skips an asset with no shots, and one whose shots have no analysis', () => {
    const { ocr } = stages();
    expect(jobOf(ocr, view({ shots: [] }))).toEqual({ skip: 'indexing.skip.noShots' });
    expect(jobOf(ocr, view({ shots: [{ shotId: A, range: range(0, 90), analysis: null }] }))).toEqual({
      skip: 'indexing.skip.notAnalysed',
    });
  });

  it('leaves an older library’s text alone: an analysis output without the marker read it itself', () => {
    const { ocr } = stages();
    // Stored before IX-O5: the analysis read the text (and its output has no `text`).
    expect(jobOf(ocr, view({ outputs: { 'vision.analyse': { shots: [] } } }))).toEqual({
      skip: 'indexing.skip.textRead',
    });
    // Marked: this stage reads.
    expect(jobOf(ocr, view()).kind).toBe('vision.readShotText');
    // No stored output (over 1 MiB): it reads again, text or not; only time.
    const withText = view({ outputs: {} }).shots.map((s) => ({
      ...s,
      analysis: s.analysis && { ...s.analysis, onScreenText: [text('OLD')] },
    }));
    expect(jobOf(ocr, view({ outputs: {}, shots: withText })).kind).toBe('vision.readShotText');
  });
});

describe('vision.ocr: where its text lands', () => {
  const output = {
    shots: [
      { shotId: A, onScreenText: [text('SALE 50%')] },
      { shotId: B, onScreenText: [] },
    ],
    ocr: createOcrMeter().counts(),
  };

  it('merges into each analysis as stored when the job settles, every other field untouched', () => {
    const { ocr } = stages();
    // The analysis changed after the job was built (a re-run with a new quality score): that one is kept.
    const now = view();
    const rerun = analysis({ quality: { ...analysis().quality, overall: 0.2 }, description: undefined });
    const settled = view({ shots: [{ ...now.shots[0]!, analysis: rerun }, now.shots[1]!] });
    const result = ocr.result(output, settled);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.analyses).toEqual([
      { shotId: A, analysis: { ...rerun, onScreenText: [text('SALE 50%')] } },
      { shotId: B, analysis: { ...settled.shots[1]!.analysis, onScreenText: [] } },
    ]);
  });

  it('gives nothing to a shot gone or unanalysed since the job was built', () => {
    const { ocr } = stages();
    const C = newId<'Shot'>() as ShotId;
    const settled = view({
      shots: [
        { shotId: C, range: range(0, 90), analysis: analysis() },
        { shotId: B, range: range(90, 20), analysis: null },
      ],
    });
    const result = ocr.result(output, settled);
    expect(result.ok && result.value.analyses).toEqual([]);
  });
});

describe('re-runs never leave old text on a new shot', () => {
  it('reads again whenever what the shots or the analysis store changes: it reads both (IX3-I3)', () => {
    const { ocr } = stages();
    expect(ocr.reads).toEqual(['vision.shots', 'vision.analyse', 'media.normalise']);
    expect(ocr.stores).toBeDefined();
    // Its version is its own now, on top of what the coupling to theirs added (6) and LIB1-FIX's cleaning (1).
    expect(ocr.version - VISION_CONFIG.ocr.version).toBe(7);
  });

  it('an analysis re-run keeps the text stored for a shot whose range didn’t move, and only for it', () => {
    const { analyse } = stages();
    const C = newId<'Shot'>() as ShotId;
    const stored = view({
      shots: [
        { shotId: A, range: range(0, 90), analysis: analysis({ onScreenText: [text('KEPT')] }) },
        // Same id, but the analysis was stored over another range: its text belongs to that one.
        {
          shotId: B,
          range: range(90, 30),
          analysis: analysis({ range: range(90, 20), onScreenText: [text('MOVED')] }),
        },
        { shotId: C, range: range(120, 30), analysis: null },
      ],
    });
    const fresh = (shotId: ShotId, r: TimeRange) => ({ shotId, analysis: analysis({ range: r }) });
    const result = analyse.result(
      {
        shots: [fresh(A, range(0, 90)), fresh(B, range(90, 30)), fresh(C, range(120, 30))],
        text: 'vision.ocr',
      },
      stored,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.analyses?.map((a) => [a.shotId, a.analysis.onScreenText.map((t) => t.text)])).toEqual(
      [
        [A, ['KEPT']],
        [B, []],
        [C, []],
      ],
    );
  });

  it('the analysis asks for no text', () => {
    const job = jobOf(stages('hi').analyse, view());
    expect(job.kind).toBe('vision.analyzeShots');
    expect(job.input).not.toHaveProperty('ocrLanguages');
  });
});
