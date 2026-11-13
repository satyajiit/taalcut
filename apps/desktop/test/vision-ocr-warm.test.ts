// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The OCR helper's warm-up from the jobs process (FIX-OCRCOLD): once, logged, never failing. */
import { err, ok } from '@taalcut/core';
import { SidecarNotFound } from '@taalcut/media';
import { OcrFailed, type OcrEngine } from '@taalcut/vision';
import { describe, expect, it } from 'vitest';
import { ocrWarmUp } from '../src/utility/roots/vision-ocr-warm';

function engine(warm: OcrEngine['warm']): OcrEngine & { calls: number } {
  const counted = {
    calls: 0,
    capabilities: async () => ok({ scripts: [], languages: [] }),
    recognize: async () => ok([]),
    ...(warm
      ? {
          warm: () => {
            counted.calls++;
            return warm();
          },
        }
      : {}),
  };
  return counted;
}

describe('ocrWarmUp', () => {
  it('runs the warm-up once however often it is asked, and logs its steps', async () => {
    const lines: string[] = [];
    const ocr = engine(async () =>
      ok({
        steps: [
          { script: 'latin', ms: 812 },
          { script: 'devanagari', ms: 33_895 },
        ],
        ms: 34_800,
        yieldedMs: 0,
      }),
    );
    const warm = ocrWarmUp(ocr, (line) => lines.push(line));
    await Promise.all([warm(), warm()]);
    await warm();
    expect(ocr.calls).toBe(1);
    expect(lines).toEqual([
      '[vision] OCR warm-up in 34.8 s (latin 812 ms, devanagari 33.9 s; waited 0 ms for reads)',
    ]);
  });

  it("lets go of other builds' compile caches once the warm-up has answered, keeping this build's", async () => {
    const lines: string[] = [];
    const kept: (string | undefined)[] = [];
    const cache = 'taalcut-mac-helper-0123456789abcdef';
    let answered = false;
    const ocr = engine(async () => {
      answered = true;
      return ok({ steps: [{ script: 'latin', ms: 812 }], ms: 812, yieldedMs: 0, cache });
    });
    // Deletes that never end don't hold the warm-up (the embedder's first load waits for it).
    const warm = ocrWarmUp(
      ocr,
      (line) => lines.push(line),
      (keep) => {
        expect(answered).toBe(true);
        kept.push(keep);
        return { discarded: ['taalcut-mac-helper-1111111111111111'], deleted: new Promise(() => {}) };
      },
    );
    await warm();
    await warm();
    expect(kept).toEqual([cache]);
    expect(lines.at(-1)).toBe(
      "[vision] let go of other mac helper builds' compile caches: taalcut-mac-helper-1111111111111111",
    );
  });

  it('prunes nothing when the warm-up failed or had nothing to say, and never fails on a prune', async () => {
    const asked: (string | undefined)[] = [];
    const prune = (keep: string | undefined) => {
      asked.push(keep);
      return { discarded: [], deleted: Promise.resolve() };
    };
    await ocrWarmUp(
      engine(async () => err(OcrFailed())),
      () => {},
      prune,
    )();
    await ocrWarmUp(
      engine(async () => ok(null)),
      () => {},
      prune,
    )();
    expect(asked).toEqual([]);
    const lines: string[] = [];
    await ocrWarmUp(
      engine(async () => ok({ steps: [], ms: 0, yieldedMs: 0 })),
      (line) => lines.push(line),
      () => {
        throw new Error('EACCES');
      },
    )();
    expect(lines.at(-1)).toBe("[vision] other helper builds' compile caches kept: Error: EACCES");
    // A Developer ID build reports no cache of its own: nothing is kept by name.
    await ocrWarmUp(
      engine(async () => ok({ steps: [], ms: 0, yieldedMs: 0 })),
      () => {},
      prune,
    )();
    expect(asked).toEqual([undefined]);
  });

  it('says nothing without a helper, says why when it fails, and nothing for a helper with no warm-up', async () => {
    const lines: string[] = [];
    await ocrWarmUp(
      engine(async () => err(SidecarNotFound({ binary: 'taalcut-mac-helper' }))),
      (l) => lines.push(l),
    )();
    await ocrWarmUp(
      engine(async () => ok(null)),
      (l) => lines.push(l),
    )();
    await ocrWarmUp(engine(undefined), (l) => lines.push(l))();
    expect(lines).toEqual([]);
    await ocrWarmUp(
      engine(async () => err(OcrFailed())),
      (l) => lines.push(l),
    )();
    expect(lines).toEqual([
      "[vision] OCR warm-up didn't run (vision.ocr_failed): text reads compile as they come",
    ]);
  });
});
