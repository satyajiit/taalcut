// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readStoredText, type LibraryRead } from '../../src/text-recall/library';
import { STAGES, writeLibrary, type FixtureStage } from './fixture';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'text-recall-library-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const SCORED = ['a.mp4', 'b.mov'];
let libraries = 0;
const read = (options: Parameters<typeof writeLibrary>[1] = {}): LibraryRead =>
  readStoredText(writeLibrary(join(dir, `library-${(libraries += 1)}.sqlite`), options), SCORED);

const reasons = (result: LibraryRead) => (result.kind === 'refused' ? result.reasons : []);
const withStage = (file: string, stage: string, change: Partial<FixtureStage>) =>
  STAGES.map((row) => (row.file === file && row.stage === stage ? { ...row, ...change } : row));

describe('readStoredText', () => {
  it('reads each scored file’s shots in seconds with their stored text, and the OCR requests', () => {
    const result = read();
    expect(result.kind).toBe('read');
    if (result.kind !== 'read') return;
    expect([...result.text.files.keys()]).toEqual(SCORED);
    expect(result.text.files.get('a.mp4')).toEqual([
      { index: 0, from: 0, to: 2, text: '00:00:01.000' },
      { index: 1, from: 2, to: 6, text: 'PIER 39 FERRY\n39 FERRY' },
    ]);
    // Three files' vision.ocr rows, three requests each.
    expect(result.text.ocrRequests).toBe(9);
  });

  it('refuses a library where any stage failed, on any file, naming the error code', () => {
    const stages = withStage('c.mp4', 'audio.transcript', {
      state: 'failed',
      error: JSON.stringify({ code: 'audio.whisper_failed', retryable: false }),
    });
    expect(reasons(read({ stages }))).toEqual(['audio.transcript failed on c.mp4: audio.whisper_failed']);
  });

  it('refuses a scored file whose shots or on-screen text did not run, were skipped or did not settle', () => {
    const stages = [
      ...withStage('a.mp4', 'vision.ocr', { state: 'skipped', reason: 'indexing.skip.noEngine' }),
    ].map((row) =>
      row.file === 'b.mov' && row.stage === 'vision.shots' ? { ...row, state: 'running' } : row,
    );
    expect(reasons(read({ stages }))).toEqual([
      'vision.ocr skipped a.mp4 (indexing.skip.noEngine)',
      'vision.shots on b.mov did not settle (running)',
    ]);
    const missing = STAGES.filter((row) => !(row.file === 'b.mov' && row.stage === 'vision.ocr'));
    expect(reasons(read({ stages: missing }))).toEqual(['vision.ocr never ran on b.mov']);
  });

  it('refuses a library that lacks a scored file', () => {
    const result = readStoredText(writeLibrary(join(dir, 'library.sqlite')), [...SCORED, 'gone.mp4']);
    expect(reasons(result)).toEqual(['gone.mp4 is not in the library']);
  });

  it('refuses a library no OCR engine read: no requests, or no counters and no text', () => {
    const none = JSON.stringify({ shots: [], ocr: { requests: 0, frames: 0 } });
    const noRequests = STAGES.map((row) => (row.stage === 'vision.ocr' ? { ...row, output: none } : row));
    expect(reasons(read({ stages: noRequests }))).toEqual([
      'no OCR engine read it (vision.ocr made no requests): indexed without the mac helper',
    ]);
    const noCounters = STAGES.map((row) =>
      row.stage === 'vision.ocr' ? { file: row.file, stage: row.stage, state: row.state } : row,
    );
    const blank = [
      { file: 'a.mp4', from: 0, to: 6, text: '' },
      { file: 'b.mov', from: 0, to: 4, text: null },
    ];
    expect(reasons(read({ stages: noCounters, shots: blank }))).toHaveLength(1);
    // Rows from before the counters, with text stored: an engine read it.
    expect(read({ stages: noCounters }).kind).toBe('read');
  });

  it('refuses a library from before on-screen text', () => {
    expect(reasons(read({ textColumn: false }))).toEqual([
      'its shots have no on-screen text column (an older library)',
    ]);
  });
});
