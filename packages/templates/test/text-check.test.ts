// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** FIX-SIGN: the on-device model's tie-break for unsure text, with a stand-in describer. */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { err, newId, ok, RationalTime, FrameRates, type TextOverlay } from '@taalcut/core';
import { answerOf, checkSceneText, MAX_TEXT_CHECKS, TEXT_CHECKS_FILE } from '../src/breakdown/text-check';
import type { DraftTextRegion } from '../src/breakdown/text-judge';
import { draftFixture as makeDraft } from './helpers/draft';

const rate = FrameRates.fps30;
const unsure = (text: string): { overlay: TextOverlay; region: DraftTextRegion } => {
  const overlay: TextOverlay = {
    id: newId<'TextOverlay'>(),
    text,
    role: 'label',
    start: RationalTime.of(10, rate),
    duration: RationalTime.of(40, rate),
    slotId: null,
    box: { x: 0.2, y: 0.2, width: 0.2, height: 0.05 },
    appearance: { size: 0.035, align: 'center', case: 'mixed', background: 'none' },
    styleKey: 'label',
    reveal: 'none',
    language: null,
    confidence: 1,
    doubts: [{ reason: 'textMaybeScene', confidence: 0.6 }],
  };
  const region: DraftTextRegion = {
    overlayId: overlay.id,
    text,
    box: overlay.box,
    start: 10,
    end: 50,
    kind: 'unsure',
    score: 0.4,
    sceneProbability: 0.6,
    signals: { withShot: 0.6 },
    lean: null,
    site: 0,
    crop: `text/${overlay.id}.png`,
  };
  return { overlay, region };
};

describe('checkSceneText', () => {
  it('takes one word as the answer, and anything else as unsure', () => {
    expect(answerOf('Scene.')).toBe('scene');
    expect(answerOf('added')).toBe('composited');
    expect(answerOf('It could be scene or added')).toBe('unsure');
    expect(answerOf('a sign on a wall')).toBe('unsure');
  });

  it('drops what the model calls the scene’s, clears the doubt on what it calls added, and asks once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'text-check-'));
    const sign = unsure('PLATFORM 2');
    const title = unsure('day one');
    const draft = {
      ...makeDraft(),
      text: [sign.overlay, title.overlay],
      textRegions: [sign.region, title.region],
    };
    const asked: string[] = [];
    const describe = async (path: string, { question }: { question: string }) => {
      asked.push(path);
      expect(question).not.toContain('PLATFORM');
      return ok(path.includes(sign.overlay.id) ? 'scene' : 'Added.');
    };
    const signal = new AbortController().signal;
    const checked = await checkSceneText(draft, dir, describe, { signal });
    expect(checked.asked).toBe(2);
    expect(checked.draft.text.map((overlay) => [overlay.text, overlay.doubts])).toEqual([
      ['day one', undefined],
    ]);
    expect(checked.draft.textRegions?.map((region) => [region.asked, region.overlayId])).toEqual([
      ['scene', null],
      ['composited', title.overlay.id],
    ]);
    expect(JSON.parse(readFileSync(join(dir, TEXT_CHECKS_FILE), 'utf8'))).toEqual({
      [sign.overlay.id]: 'scene',
      [title.overlay.id]: 'composited',
    });
    // The same reel again: the saved answers apply, nothing is asked.
    const again = await checkSceneText(draft, dir, describe, { signal });
    expect(again.asked).toBe(0);
    expect(again.draft.text).toHaveLength(1);
    expect(asked).toHaveLength(2);
  });

  it('asks at most a few, and stops at the first failed call, leaving the doubts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'text-check-'));
    const many = Array.from({ length: MAX_TEXT_CHECKS + 3 }, (_, k) => unsure(`line ${k}`));
    const draft = {
      ...makeDraft(),
      text: many.map((m) => m.overlay),
      textRegions: many.map((m) => m.region),
    };
    let calls = 0;
    const fails = async () => {
      calls++;
      return err({ code: 'vision.no_local_model', retryable: false } as never);
    };
    const checked = await checkSceneText(draft, dir, fails, { signal: new AbortController().signal });
    expect([calls, checked.asked, checked.draft.text.length]).toEqual([1, 0, MAX_TEXT_CHECKS + 3]);
  });
});
