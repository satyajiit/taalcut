// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: captionSafeZone on a text item. Where a video's text sits is its placer's to judge (the owner's rule: no
 * code decides it), so a text outside the safe rect is a note: the check warns, names the text and how far out it
 * is, and plans no move for it. A caption outside the rect fails as before, with its ready `captions.setStyle`; with
 * both, the captions' failure comes first and the text is still named. The probe measures the text as laid out, not
 * the item's box: a right-aligned title sits at its box's right edge.
 */
import { describe, expect, it } from 'vitest';
import { CAPTION_COMMANDS, newId, type Rect } from '@taalcut/core';
import { safeRectFor } from '../../src/presets/presets.v1';
import { captionSafeZoneCheck } from '../../src/qa/checks/captions';
import { textNotes } from '../../src/tools/schemas';
import type { ProbedTextBox } from '../../src/types';
import { captions, qaPlan, report, target } from './support';

/** Explicit cross-post rect: x 120–780, y 288–1248 (Shorts ∩ Reels ∩ TikTok). */
const SAFE = safeRectFor([]);
const ID = newId<'TimelineItem'>();

const probed = (rect: Rect, frame = 40, overrides: Partial<ProbedTextBox> = {}): ProbedTextBox => ({
  kind: 'text',
  id: ID,
  frame,
  box: rect,
  lines: 1,
  overflow: false,
  fontsReady: true,
  color: '#ffffff',
  ...overrides,
});

const plan = qaPlan({
  texts: [{ id: ID, span: { start: 20, end: 60 }, probeFrame: 40 }],
  cues: [{ id: 'cue-1', span: { start: 0, end: 30 }, probeFrames: [15] }],
});
/** A title whose words end at x 842: 62 px past the rect's 780, 60 over the tolerance. */
const ON_THE_RAIL: Rect = { x: 632, y: 960, width: 210, height: 52 };
const INSIDE: Rect = { x: 300, y: 700, width: 300, height: 52 };
const CUE_BELOW: Rect = { x: 250, y: 1700, width: 560, height: 180 };

describe('captionSafeZone on a text item (TXT1)', () => {
  it('a text outside the safe rect is a note: a warning that names it and how far out it is, with no fix', () => {
    const result = captionSafeZoneCheck({
      plan,
      captions: null,
      boxes: [probed(ON_THE_RAIL)],
      safe: SAFE,
      target,
    });
    expect(result.status).toBe('warn');
    expect(result.measured).toEqual({ value: 60, unit: 'px' });
    expect(result.findings).toEqual([
      {
        frames: { start: 40, end: 41 },
        target: { kind: 'text', id: ID },
        measured: { value: 60, unit: 'px' },
      },
    ]);
    expect(result.fixes).toEqual([]);
    // Right across the frame, top to bottom: still a note.
    const everywhere = captionSafeZoneCheck({
      plan,
      captions: null,
      boxes: [probed({ x: 0, y: 0, width: 1080, height: 1920 })],
      safe: SAFE,
      target,
    });
    expect(everywhere.status).toBe('warn');
    expect(everywhere.fixes).toEqual([]);
  });

  it('a text inside the rect passes', () => {
    expect(
      captionSafeZoneCheck({ plan, captions: null, boxes: [probed(INSIDE)], safe: SAFE, target }).status,
    ).toBe('pass');
  });

  it('a caption outside the rect still fails, with its ready move; a text outside with it is named after it', () => {
    const track = captions([{ id: 'cue-1', start: 0, frames: 30, text: 'Watch this' }], { anchorY: 0.95 });
    const cue = probed(CUE_BELOW, 15, { kind: 'caption', id: 'cue-1', lines: 2 });
    const alone = captionSafeZoneCheck({ plan, captions: track, boxes: [cue], safe: SAFE, target });
    expect(alone.status).toBe('fail');
    expect(alone.fixes).toHaveLength(1);
    expect(alone.fixes[0]).toMatchObject({ kind: 'command', command: CAPTION_COMMANDS.setStyle });
    const both = captionSafeZoneCheck({
      plan,
      captions: track,
      boxes: [probed(ON_THE_RAIL), cue],
      safe: SAFE,
      target,
    });
    expect(both.status).toBe('fail');
    expect(both.findings.map((finding) => finding.target)).toEqual([
      { kind: 'caption', id: 'cue-1' },
      { kind: 'text', id: ID },
    ]);
    // The fix is the captions' alone: nothing moves the text.
    expect(both.fixes).toEqual(alone.fixes);
  });

  it('the notes of a report are the two checks’ findings about texts, whatever else the report holds', () => {
    const outside = captionSafeZoneCheck({
      plan,
      captions: null,
      boxes: [probed(ON_THE_RAIL)],
      safe: SAFE,
      target,
    });
    expect(textNotes(report([outside]))).toEqual([
      {
        check: 'captionSafeZone',
        itemId: ID,
        frames: { start: 40, end: 41 },
        measured: { value: 60, unit: 'px' },
      },
    ]);
    expect(textNotes(report([]))).toEqual([]);
    expect(textNotes(null)).toEqual([]);
  });
});
