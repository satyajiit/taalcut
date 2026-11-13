// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** IX-B2: busy per file and stage, the decode counters, and the ready lane's stored lines checked. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { footageLooks } from '../../../src/perf/timeline/per-file';
import { timelineMarkdown } from '../../../src/perf/timeline/markdown';
import { analyseTimeline, buildTimeline } from '../../../src/perf/timeline/report';
import { record, tempLibrary, type LibraryOptions } from './fixture';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const library = (options: LibraryOptions = {}) => tempLibrary(dirs, options);

const decodes = (full: number, original: number, ffmpeg = 1, ffprobe = 0) =>
  JSON.stringify({
    decodes: { ffmpeg, ffprobe, fullDecodes: full, partialDecodes: 0, originalFullDecodes: original },
  });

describe('busy per file', () => {
  it('sums each stage per file, busiest file first, with the looks when the set has them', () => {
    const report = buildTimeline(library(), record(), new Map([['a.mov', ['pattern', 'life']]]));
    expect(report.files.map((file) => [file.file, file.totalMs])).toEqual([
      ['b.mov', 3090],
      ['a.mov', 2150],
    ]);
    expect(report.files[1]).toMatchObject({
      busyMs: { 'library.hash': 90, 'vision.shots': 1000, 'vision.embed': 1000, 'vision.describe': 60 },
      looks: ['pattern', 'life'],
    });
    expect(report.files[0]?.looks).toBeNull();
    const markdown = timelineMarkdown(report);
    expect(markdown).toContain(
      '| File | Kind | Total | vision.shots | vision.embed | library.hash | vision.describe | Looks |',
    );
    expect(markdown).toContain('| a.mov | video | 2.1 | 1.0 | 1.0 | 0.1 | 0.1 | pattern, life |');
    expect(markdown).not.toContain('## Decodes');
  });

  it('has no looks for a folder without a manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-looks-'));
    dirs.push(dir);
    expect(footageLooks(dir).size).toBe(0);
  });
});

describe('decode counters', () => {
  it('sums them per stage and takes the median per video file', () => {
    const report = buildTimeline(
      library({
        outputs: {
          'A vision.shots': decodes(1, 1),
          'A vision.embed': decodes(0, 0, 1, 1),
          'B vision.shots': decodes(2, 2, 2),
          'B vision.embed': JSON.stringify({ decodes: { ffmpeg: 'two' } }),
          'A library.hash': JSON.stringify({ contentHash: 'abc' }),
        },
      }),
      record(),
    );
    expect(report.decodes).toEqual({
      rows: 3,
      unreadable: 1,
      medianOriginalFullDecodes: 1.5,
      medianSpawns: 2.5,
      byStage: [
        {
          stage: 'vision.embed',
          ffmpeg: 1,
          ffprobe: 1,
          fullDecodes: 0,
          partialDecodes: 0,
          originalFullDecodes: 0,
        },
        {
          stage: 'vision.shots',
          ffmpeg: 3,
          ffprobe: 0,
          fullDecodes: 3,
          partialDecodes: 0,
          originalFullDecodes: 3,
        },
      ],
    });
    expect(timelineMarkdown(report)).toContain('3 stage rows reported decodes; 1 in another shape, left out');
  });
});

const ocr = (requests: number, frames: number, engine: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    ocr: { requests, frames, refineCalls: 2, refineDecodes: 2, ms: { engine, decode: 5 }, ...extra },
  });

describe('OCR counters', () => {
  it('sums them per file and per run beside the busy time, and passes the run totals on', () => {
    const path = library({
      outputs: {
        'A vision.shots': ocr(4, 40, 1600, { sampled: 50, reused: 10 }),
        'B vision.shots': ocr(2, 10, 300),
        'B vision.embed': JSON.stringify({ ocr: { requests: 'many' } }),
      },
    });
    const report = buildTimeline(path, record());
    expect(report.ocr).toMatchObject({
      rows: 2,
      unreadable: 1,
      stages: ['vision.shots'],
      totals: {
        requests: 6,
        frames: 50,
        sampled: 50,
        reused: 10,
        refineCalls: 4,
        engineMs: 1900,
        engineMsPerFrame: 38,
        busyMs: 3000,
      },
    });
    expect(report.ocr?.files.map((file) => [file.file, file.requests, file.engineMsPerFrame])).toEqual([
      ['a.mov', 4, 40],
      ['b.mov', 2, 30],
    ]);
    expect(timelineMarkdown(report)).toContain('| **Run** | 6 | 50 | 50 | 10 | 4 | 4 | 1.9 | 38 | 3.0 |');
    const dir = path.replace(/index-library\.sqlite$/, '');
    writeFileSync(join(dir, 'index-bench.json'), '{}');
    expect(analyseTimeline(dir, record())?.ocr).toMatchObject({
      requests: 6,
      frames: 50,
      engineMsPerFrame: 38,
    });
  });
});

describe("the ready lane's stored lines", () => {
  it('reads complete_at beside searchable_at and names the assets where stored and computed disagree', () => {
    const report = buildTimeline(
      library({ searchable: { A: 4230, B: 5235 }, complete: { A: 5300, B: 5400 } }),
      record(),
    );
    expect(report).toMatchObject({ completeStored: true, completeMs: 5300, storedCompleteMs: 5400 });
    expect(report.mismatches).toEqual([
      { file: 'b.mov', line: 'complete', computedMs: 5236, storedMs: 5400 },
    ]);
    expect(timelineMarkdown(report)).toContain('b.mov complete computed 5.2 s, stored 5.4 s');
  });

  it('has nothing to check without stored lines', () => {
    const report = buildTimeline(library(), record());
    expect(report).toMatchObject({ completeStored: false, storedCompleteMs: null, mismatches: [] });
  });
});
