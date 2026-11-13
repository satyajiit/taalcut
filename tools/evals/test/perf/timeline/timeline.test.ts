// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** IX-B2: spans, the two finish lines, class and lane usage, the critical path, the Gantt and the files. */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { criticalPath, lastFinished } from '../../../src/perf/timeline/critical-path';
import { gantt } from '../../../src/perf/timeline/gantt';
import { laneUsage } from '../../../src/perf/timeline/lanes';
import { readLibraryRows } from '../../../src/perf/timeline/library-rows';
import { assetMilestones, overall, searchableRule } from '../../../src/perf/timeline/milestones';
import { analyseTimeline, buildTimeline } from '../../../src/perf/timeline/report';
import { stageSpans } from '../../../src/perf/timeline/spans';
import { ADDED, PIPELINE, record, tempLibrary, type LibraryOptions } from './fixture';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const library = (options: LibraryOptions = {}) => tempLibrary(dirs, options);

function spans(path = library()) {
  return stageSpans(readLibraryRows(path, ADDED).stages, ADDED, PIPELINE);
}

describe('stage spans', () => {
  it('puts every stage on the run clock with its class and lane', () => {
    const embed = spans().find((span) => span.file === 'a.mov' && span.stage === 'vision.embed');
    expect(embed).toMatchObject({
      queuedMs: 1230,
      startedMs: 3230,
      finishedMs: 4230,
      resource: 'gpu',
      lane: 'vision.embedder',
    });
    const skipped = spans().find((span) => span.file === 'b.mov' && span.stage === 'vision.describe');
    expect(skipped).toMatchObject({
      state: 'skipped',
      kind: null,
      resource: null,
      startedMs: null,
      finishedMs: 5236,
    });
  });

  it("reads each job's order key once jobs have the column", () => {
    expect(spans().every((span) => span.orderKey === null)).toBe(true);
    const keyed = spans(library({ orderKey: true }));
    expect(
      keyed.filter((span) => span.kind !== null).map((span) => [span.file, span.orderKey]),
    ).toContainEqual(['b.mov', 2]);
  });

  it('reads library-wide jobs, and no stored searchable_at before the ready lane', () => {
    const rows = readLibraryRows(library(), ADDED);
    expect(rows.libraryJobs.map((job) => job.kind)).toEqual(['library.scanSource']);
    expect(rows.storedSearchableAt).toBeNull();
  });
});

describe('finish lines', () => {
  it("uses design C's set until stages declare a milestone, the thumbnail by media.previews", () => {
    const rule = searchableRule(PIPELINE);
    expect(rule.source).toBe('design-c');
    expect(rule.stages).toContain('media.previews');
    const assets = assetMilestones(spans(), rule, null, ADDED);
    expect(
      assets.map((asset) => [asset.file, asset.searchableMs, asset.searchableBy, asset.completeMs]),
    ).toEqual([
      ['a.mov', 4230, 'vision.embed', 5300],
      ['b.mov', 5235, 'vision.embed', 5236],
    ]);
    expect(overall(assets, (asset) => asset.searchableMs)).toBe(5235);
    expect(overall(assets, (asset) => asset.completeMs)).toBe(5300);
  });

  it("takes the stages' declared milestone when they have one", () => {
    const declared = {
      ...PIPELINE,
      stages: PIPELINE.stages.map((stage) => ({
        ...stage,
        milestone: ['library.hash', 'vision.shots'].includes(stage.stage) ? 'searchable' : 'complete',
      })),
    };
    const rule = searchableRule(declared);
    expect(rule).toEqual({ source: 'declared', stages: ['library.hash', 'vision.shots'] });
    const assets = assetMilestones(spans(), rule, null, ADDED);
    expect(assets.map((asset) => asset.searchableMs)).toEqual([1220, 3225]);
  });

  it('has no finish line while a stage never settled', () => {
    const path = library({
      stages: [
        {
          asset: 'A',
          stage: 'library.hash',
          kind: 'library.hashAsset',
          resource: 'io',
          state: 'failed',
          finished: 50,
        },
      ],
    });
    const assets = assetMilestones(spans(path), searchableRule(PIPELINE), null, ADDED);
    expect(assets[0]).toMatchObject({ searchableMs: null, completeMs: null });
    expect(overall(assets, (asset) => asset.completeMs)).toBeNull();
    expect(overall([], (asset) => asset.completeMs)).toBeNull();
  });

  it('leaves a description held for its model out of complete, and counts it (LIB1-FIX)', () => {
    const held = spans().map((span) =>
      span.file === 'b.mov' && span.stage === 'vision.describe'
        ? {
            ...span,
            state: 'waiting',
            reason: 'library.stage.modelMissing',
            startedMs: null,
            finishedMs: null,
          }
        : span,
    );
    const assets = assetMilestones(held, searchableRule(PIPELINE), null, ADDED);
    expect(assets.map((asset) => [asset.file, asset.completeMs, asset.heldForModel])).toEqual([
      ['a.mov', 5300, 0],
      ['b.mov', 5235, 1],
    ]);
    // Waiting for anything else, the description still keeps the file from complete.
    const waiting = held.map((span) =>
      span.reason === 'library.stage.modelMissing' ? { ...span, reason: null } : span,
    );
    const open = assetMilestones(waiting, searchableRule(PIPELINE), null, ADDED);
    expect(open.map((asset) => [asset.completeMs, asset.heldForModel])).toEqual([
      [5300, 0],
      [null, 0],
    ]);
  });

  it("reads the ready lane's stored searchable_at beside the computed one", () => {
    const path = library({ searchable: { A: 1300, B: null } });
    const rows = readLibraryRows(path, ADDED);
    const assets = assetMilestones(spans(path), searchableRule(PIPELINE), rows.storedSearchableAt, ADDED);
    expect(assets.map((asset) => asset.storedSearchableMs)).toEqual([1300, null]);
  });
});

describe('class and lane usage', () => {
  it('measures busy against wall and the most at once', () => {
    const usage = laneUsage(spans());
    expect(usage.classes.find((item) => item.name === 'gpu')).toMatchObject({
      jobs: 5,
      busyMs: 5060,
      wallMs: 5060,
      overlap: 1,
      peak: 1,
    });
    expect(usage.classes.find((item) => item.name === 'io')).toMatchObject({
      busyMs: 180,
      wallMs: 100,
      overlap: 1.8,
      peak: 2,
    });
    expect(usage.lanes.map((item) => item.name)).toEqual([
      'gpu/(no lane)',
      'gpu/vision.embedder',
      'io/(no lane)',
    ]);
  });
});

describe('critical path', () => {
  const needs = (stage: string) => PIPELINE.stages.find((item) => item.stage === stage)?.needs ?? [];

  it('walks back through slot releases and needs to Add folder, covering every millisecond', () => {
    const all = spans();
    const last = lastFinished(all);
    expect(last).toMatchObject({ file: 'a.mov', stage: 'vision.describe' });
    const target = all.find((span) => span.file === 'b.mov' && span.stage === 'vision.embed');
    if (target === undefined) throw new Error('fixture');
    const path = criticalPath(all, target, needs);
    expect(
      path.segments.map((segment) => [
        segment.type,
        segment.fromMs,
        segment.toMs,
        segment.file,
        segment.stage,
      ]),
    ).toEqual([
      ['import', 0, 100, 'a.mov', 'library.hash'],
      ['wait-slot', 100, 110, 'a.mov', 'library.hash'],
      ['run', 110, 200, 'a.mov', 'library.hash'],
      ['wait-feed', 200, 210, 'a.mov', 'vision.shots'],
      ['wait-slot', 210, 220, 'a.mov', 'vision.shots'],
      ['run', 220, 1220, 'a.mov', 'vision.shots'],
      ['wait-slot', 1220, 1225, 'b.mov', 'vision.shots'],
      ['run', 1225, 3225, 'b.mov', 'vision.shots'],
      ['wait-slot', 3225, 3230, 'a.mov', 'vision.embed'],
      ['run', 3230, 4230, 'a.mov', 'vision.embed'],
      ['wait-slot', 4230, 4235, 'b.mov', 'vision.embed'],
      ['run', 4235, 5235, 'b.mov', 'vision.embed'],
    ]);
    const total = Object.values(path.byType).reduce((sum, ms) => sum + ms, 0);
    expect(total).toBe(5235);
    expect(path.byResource.gpu).toBe(5000);
    expect(path.byStage['vision.shots']).toBe(3000);
  });

  it('goes through a skipped need to the stage before it', () => {
    const all = spans();
    const skipped = all.find((span) => span.file === 'b.mov' && span.stage === 'vision.describe');
    if (skipped === undefined) throw new Error('fixture');
    const path = criticalPath(all, skipped, needs);
    expect(path.endMs).toBe(5236);
    // Skipped when its need finished: a millisecond of the pipeline deciding, after B's embed ran.
    expect(path.segments.at(-1)).toMatchObject({ type: 'wait-feed', stage: 'vision.describe', fromMs: 5235 });
    expect(path.segments.at(-2)).toMatchObject({ type: 'run', stage: 'vision.embed', file: 'b.mov' });
  });
});

describe('the report', () => {
  it('draws a Gantt with each file, its stages and its finish lines', () => {
    const all = spans();
    const assets = assetMilestones(all, searchableRule(PIPELINE), null, ADDED);
    const text = gantt(all, assets, { width: 53, endMs: 5300 });
    expect(text).toContain('a.mov');
    expect(text).toMatch(/vision\.shots\s+gpu\s+\|\s*-*#+/);
    expect(text).toMatch(/b\.mov\s+\|\s+\*/);
    expect(text).toMatch(/gpu\s+\|\.*1+/);
  });

  it('writes timeline.json and timeline.md and gives the finish lines, stored first', () => {
    const path = library({ searchable: { A: 1300, B: 3300 } });
    const dir = join(path, '..');
    const finish = analyseTimeline(dir, record());
    expect(finish).toEqual({
      searchableMs: 3300,
      completeMs: 5300,
      completeHeldForModel: 0,
      ocr: null,
      transcripts: { kinds: {}, skipped: 0 },
      decodes: null,
    });
    const markdown = readFileSync(join(dir, 'timeline.md'), 'utf8');
    expect(markdown).toContain('Stored by the library: 3.3 s');
    expect(markdown).toContain("computed from design C's stage set");
    expect(markdown).toContain('To fully analysed: 5.3 s, ending with a.mov vision.describe');
    expect(existsSync(join(dir, 'timeline.json'))).toBe(true);
    const report = buildTimeline(path, record());
    expect(report.completeMinPerHour).toBe(2.7);
    expect(report.libraryJobs[0]).toMatchObject({ kind: 'library.scanSource', queuedMs: 1, finishedMs: 90 });
  });

  it('has nothing to say without a library copy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-timeline-'));
    dirs.push(dir);
    expect(analyseTimeline(dir, record())).toBeNull();
  });
});
