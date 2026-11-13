// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** IX3-B1 in every bench run: the run's library scored by the recall eval's rule, and summary.md's line. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTextRecall, textRecallLine } from '../../../src/perf/bench/text-recall';
import { MANIFEST, STAGES, writeLibrary } from '../../text-recall/fixture';
import { tempDir } from './runner-fakes';

function footage(manifest: unknown): string {
  const dir = join(tempDir(), 'footage');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

describe('a run’s on-screen text recall', () => {
  it('scores the run’s library against the floor when its set has no committed baseline', () => {
    const library = writeLibrary(join(tempDir(), 'index-library.sqlite'));
    expect(runTextRecall(library, footage(MANIFEST))).toEqual({
      found: 4,
      total: 5,
      missed: ['b.mov:PARK'],
      lost: null,
      refused: null,
      // Under the default floor of 19 words.
      pass: false,
    });
  });

  it('gates ix-v1 against its committed baseline, and names a refused library', () => {
    const failed = STAGES.map((row) => (row.stage === 'vision.ocr' ? { ...row, state: 'running' } : row));
    const library = writeLibrary(join(tempDir(), 'index-library.sqlite'), { stages: failed });
    const run = runTextRecall(library, footage({ ...MANIFEST, set: 'ix-v1' }));
    expect(run).toMatchObject({ found: null, total: 5, pass: false });
    expect(run?.refused).toContain('vision.ocr on a.mp4 did not settle (running)');
    const scored = runTextRecall(
      writeLibrary(join(tempDir(), 'index-library.sqlite')),
      footage({ ...MANIFEST, set: 'ix-v1' }),
    );
    // The fixture's words are not ix-v1's: every baseline word is lost.
    expect(scored?.lost).toHaveLength(20);
  });

  it('is not scored without on-screen lines', () => {
    const library = writeLibrary(join(tempDir(), 'index-library.sqlite'));
    expect(runTextRecall(library, footage({ clips: [{ file: 'a.mp4' }] }))).toBeNull();
    expect(runTextRecall(library, join(tempDir(), 'no-footage'))).toBeNull();
  });

  it('fails a run that kept no library, and counts it (IX3-F5, M7)', () => {
    const none = join(tempDir(), 'none.sqlite');
    const missing = runTextRecall(none, footage(MANIFEST));
    expect(missing).toEqual({
      found: null,
      total: 5,
      missed: [],
      lost: null,
      refused: [`the run kept no library (${none})`],
      pass: false,
    });
    const pass = { found: 19, total: 24, missed: [], lost: [], refused: null, pass: true };
    expect(textRecallLine([pass, missing])).toContain('gate passed in 1 of 2 runs');
  });

  it('puts the runs in one summary.md line', () => {
    const pass = { found: 19, total: 24, missed: [], lost: [], refused: null, pass: true };
    expect(textRecallLine([pass, pass])).toBe(
      'On-screen text recall (rule and baseline of eval:text-recall): 19/24, 19/24 words read; gate passed in 2 of 2 runs.',
    );
    const lost = { ...pass, found: 18, lost: ['garden-1080-h264-ptbr.mp4:JARDIM'], pass: false };
    const refused = { ...pass, found: null, refused: ['vision.ocr failed on a.mp4: x'], pass: false };
    expect(textRecallLine([pass, lost, refused])).toBe(
      'On-screen text recall (rule and baseline of eval:text-recall): 19/24, 18/24, refused words read; gate passed ' +
        'in 1 of 3 runs; **lost garden-1080-h264-ptbr.mp4:JARDIM**; **refused: vision.ocr failed on a.mp4: x**.',
    );
    expect(textRecallLine([null, undefined])).toMatch(/not scored/);
  });
});
