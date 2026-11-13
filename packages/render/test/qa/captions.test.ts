// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Caption checks on probe boxes laid out the way the shell lays them out:
 * centred across the preset's safe width, the block's centre at anchorY.
 * The boxes are synthetic so every preset and language runs without a
 * browser; the probe itself is the shell's (captions.int.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { CAPTION_COMMANDS, captionCommandPayloads, type ExportPresetId, type Rect } from '@taalcut/core';
import { captionGlyphIssues } from '../../src/captions/glyphs';
import { presetFor, safeRectFor } from '../../src/presets/presets.v1';
import {
  captionGlyphsCheck,
  captionOverflowCheck,
  captionReadabilityCheck,
  captionSafeZoneCheck,
  contrastRatio,
  wordCollision,
  type CaptionCheckInput,
} from '../../src/qa/checks/captions';
import { planCaptionFix } from '../../src/qa/fixes';
import type { CaptionFontId, ProbedTextBox, ProbedWord } from '../../src/types';
import { captions, glyphStub, qaPlan, target } from './support';

const PRESETS: readonly ExportPresetId[] = ['shorts', 'reels', 'tiktok', 'device'];
/** A two-line cue at 72 px, its shaped width as Chrome measured these phrases. */
const LANGUAGES = {
  en: { text: 'Watch this before you post', width: 560 },
  hi: { text: 'पोस्ट करने से पहले यह देखो', width: 600 },
  es: { text: 'Mira esto antes de publicar', width: 620 },
  pt: { text: 'Veja isto antes de postar', width: 590 },
  hinglish: { text: 'Post karne se pehle yeh dekho', width: 610 },
} as const;
const LINE_HEIGHT = 90;

function box(safe: Rect, width: number, anchorY: number, lines = 2, overrides: Partial<ProbedTextBox> = {}): ProbedTextBox {
  const height = lines * LINE_HEIGHT;
  return {
    kind: 'caption',
    id: 'cue-1',
    frame: 15,
    box: { x: Math.round(safe.x + (safe.width - width) / 2), y: Math.round(anchorY * 1920 - height / 2), width, height },
    lines,
    overflow: false,
    fontsReady: true,
    color: '#ffffff',
    ...overrides,
  };
}

function input(text: string, preset: ExportPresetId, boxes: readonly ProbedTextBox[], style = {}): CaptionCheckInput {
  return {
    plan: qaPlan({ cues: [{ id: 'cue-1', span: { start: 0, end: 30 }, probeFrames: [15] }] }),
    captions: captions([{ id: 'cue-1', start: 0, frames: 30, text }], style),
    boxes,
    safe: presetFor(preset).safe,
    target,
  };
}

const inside = (rect: Rect, safe: Rect) =>
  rect.x >= safe.x - 2 && rect.y >= safe.y - 2 && rect.x + rect.width <= safe.x + safe.width + 2 && rect.y + rect.height <= safe.y + safe.height + 2;

describe('captionSafeZone', () => {
  describe.each(Object.entries(LANGUAGES))('%s', (_language, { text, width }) => {
    it.each(PRESETS)('passes at anchorY 0.55 on %s', (preset) => {
      const safe = presetFor(preset).safe;
      const caption = input(text, preset, [box(safe, width, 0.55)]);
      expect(captionSafeZoneCheck(caption).status).toBe('pass');
      expect(captionOverflowCheck(caption).status).toBe('pass');
      expect(captionGlyphsCheck(caption, captionGlyphIssues).status).toBe('pass');
    });

    it.each(PRESETS)('fails at anchorY 0.95 on %s, and the fix moves it back inside', (preset) => {
      const safe = presetFor(preset).safe;
      const result = captionSafeZoneCheck(input(text, preset, [box(safe, width, 0.95)], { anchorY: 0.95 }));
      expect(result.status).toBe('fail');
      const fix = result.fixes[0];
      if (fix?.kind !== 'command') throw new Error('expected a command fix');
      expect(fix.command).toBe(CAPTION_COMMANDS.setStyle);
      expect(captionCommandPayloads[CAPTION_COMMANDS.setStyle].safeParse(fix.payload).success).toBe(true);
      const { anchorY } = (fix.payload as { style: { anchorY: number } }).style;
      expect(inside(box(safe, width, anchorY).box, safe)).toBe(true);
    });
  });

  it.each(PRESETS)('fails a box reaching x > 1020 on %s (under the action rail)', (preset) => {
    const rail = box({ x: 600, y: 0, width: 430, height: 1920 }, 430, 0.55);
    expect(rail.box.x + rail.box.width).toBeGreaterThan(1020);
    const result = captionSafeZoneCheck(input('Watch this', preset, [rail]));
    expect(result.status).toBe('fail');
    expect(result.measured!.value).toBeGreaterThan(0);
  });

  it('allows 2 px of anti-aliasing past the edge, and no more', () => {
    const safe = presetFor('device').safe;
    const edge = (overshoot: number) =>
      box(safe, 400, 0.55, 2, { box: { x: safe.x - overshoot, y: 900, width: 400, height: 180 } });
    expect(captionSafeZoneCheck(input('Watch', 'device', [edge(2)])).status).toBe('pass');
    expect(captionSafeZoneCheck(input('Watch', 'device', [edge(3)])).status).toBe('fail');
  });

  it('asks the agent to move a text overlay, and skips when nothing is on screen', () => {
    const safe = presetFor('tiktok').safe;
    const overlay = box(safe, 300, 0.1, 1, { kind: 'text', id: 'title' });
    const plan = qaPlan({ texts: [{ id: 'title', span: { start: 0, end: 30 }, probeFrame: 15 }] });
    const result = captionSafeZoneCheck({ plan, captions: null, boxes: [overlay], safe, target });
    expect(result.fixes).toEqual([{ kind: 'agent', instructionKey: 'qa.fixes.moveText', params: { textId: 'title' } }]);
    expect(captionSafeZoneCheck({ plan: qaPlan(), captions: null, boxes: [], safe, target }).status).toBe('skipped');
  });
});

describe('planCaptionFix', () => {
  // These oversized blocks exercise the narrow cross-post rectangle, not camera-roll title margins.
  const safe = safeRectFor([]);
  const style = { anchorY: 0.95, sizePx: 72, maxWords: 6, maxLines: 2 };

  it('shrinks a block too wide for the safe width, never under 44 px', () => {
    expect(planCaptionFix({ boxes: [box(safe, 900, 0.55)], style, safe, canvasHeight: 1920 })).toEqual({ sizePx: 52 });
    expect(planCaptionFix({ boxes: [box(safe, 2000, 0.55)], style, safe, canvasHeight: 1920 })).toEqual({ sizePx: 44, maxWords: 3 });
  });

  it('shrinks and centres a block taller than the safe rect', () => {
    const tall = box(safe, 600, 0.55, 12);
    const patch = planCaptionFix({ boxes: [tall], style, safe, canvasHeight: 1920 });
    expect(patch.sizePx).toBeLessThan(72);
    expect(patch.anchorY).toBeCloseTo((safe.y + safe.height / 2) / 1920, 3);
  });
});

describe('captionOverflow', () => {
  it('fails a 30-character Hindi compound at 140 px with one line allowed', () => {
    const safe = presetFor('device').safe;
    const result = captionOverflowCheck(
      input('अंतरराष्ट्रीयकरणप्रक्रियाविशेषज्ञता', 'device', [box(safe, 640, 0.55, 2, { overflow: true })], { sizePx: 140, maxLines: 1 }),
    );
    expect(result.status).toBe('fail');
    expect(result.fixes).toEqual([
      { kind: 'command', labelKey: 'qa.fixes.shrinkCaptions', command: CAPTION_COMMANDS.setStyle, payload: { ...target, style: { sizePx: 70 } } },
      { kind: 'command', labelKey: 'qa.fixes.rebuildCaptions', command: CAPTION_COMMANDS.rebuild, payload: { ...target } },
    ]);
  });

  it('fails twelve Spanish words at 120 px on three lines when two are allowed', () => {
    const safe = presetFor('device').safe;
    const words = 'Esta es la mejor manera de editar tus videos cortos para redes';
    const result = captionOverflowCheck(input(words, 'device', [box(safe, 640, 0.55, 3)], { sizePx: 120, maxWords: 12, maxLines: 2 }));
    expect(result.status).toBe('fail');
    expect(result.measured).toEqual({ value: 3, unit: 'count' });
    expect(result.fixes[0]).toMatchObject({ payload: { style: { sizePx: 80 } } });
  });

  it('fails a box that leaves the 1080×1920 frame', () => {
    const out = box(presetFor('device').safe, 400, 0.55, 2, { box: { x: 900, y: 900, width: 400, height: 180 } });
    expect(captionOverflowCheck(input('Watch', 'device', [out])).status).toBe('fail');
  });

  /** Three words on a line at a pop peak: the middle one popped by `grow` px a side (envelopes, canvas px). */
  const popped = (grow: number, scale = 1.18): ProbedWord[] => [
    { box: { x: 200, y: 900, width: 150, height: 100 }, scale: 1 },
    { box: { x: 370 - grow, y: 890, width: 160 + 2 * grow, height: 118 }, scale },
    { box: { x: 550, y: 900, width: 150, height: 100 }, scale: 1 },
    // The next line, at rest, below the room the pop's drop takes.
    { box: { x: 300, y: 1010, width: 200, height: 100 }, scale: 1 },
    // A word at rest whose box touches the one above it, as plain lines do.
    { box: { x: 560, y: 1000, width: 100, height: 100 }, scale: 1 },
  ];
  const safe = presetFor('device').safe;

  it('fails a popped word that runs into its neighbour, by how deep', () => {
    const result = captionOverflowCheck(input('one two three four', 'device', [box(safe, 500, 0.55, 2, { words: popped(26) })]));
    expect(result.status).toBe('fail');
    expect(result.findings).toEqual([expect.objectContaining({ measured: { value: 6, unit: 'px' } })]);
    expect(wordCollision(popped(26))).toBeCloseTo(6, 9);
  });

  it('passes a popped word clear of every other, words at rest that touch, and a 1 px graze', () => {
    for (const words of [popped(14), popped(21), popped(40, 1).map((word) => ({ ...word, scale: 1 }))])
      expect(captionOverflowCheck(input('one two three four', 'device', [box(safe, 500, 0.55, 2, { words })])).status).toBe('pass');
  });
});

describe('captionGlyphs (real cmap coverage)', () => {
  const check = (text: string, font: CaptionFontId = 'notoSans') =>
    captionGlyphsCheck({ captions: captions([{ id: 'cue-1', start: 0, frames: 30, text }], { font }), target }, captionGlyphIssues);

  it('passes Hindi conjuncts in Mukta and emoji through Noto Color Emoji', () => {
    expect(check('क्षत्रिय श्रृंगार द्वार', 'mukta').status).toBe('pass');
    expect(check('Watch this 🔥👀').status).toBe('pass');
  });

  it.each([
    ['Tamil', 'தமிழ்'],
    ['Arabic', 'مرحبا بالعالم'],
  ])('fails %s in every stack and asks for the text to change', (_script, text) => {
    const result = check(text);
    expect(result.status).toBe('fail');
    expect(result.overridable).toBe(false);
    expect(result.fixes).toEqual([{ kind: 'agent', instructionKey: 'qa.fixes.editCaptionText', params: { cueId: 'cue-1' } }]);
  });

  it('offers a covering curated font when one exists', () => {
    const antonOnly = (cues: readonly { id: string; text: string }[], font: string) =>
      font === 'anton' ? cues.map((cue) => ({ cueId: cue.id, codepoints: [0x0915] })) : [];
    const result = captionGlyphsCheck({ captions: captions([{ id: 'cue-1', start: 0, frames: 30, text: 'क' }], { font: 'anton' }), target }, antonOnly);
    expect(result.fixes).toEqual([
      { kind: 'command', labelKey: 'qa.fixes.coveringFont', command: CAPTION_COMMANDS.setStyle, payload: { ...target, style: { font: 'notoSans' } } },
    ]);
  });

  it('fails a cue whose font the browser had not loaded at capture', () => {
    const caption = input('Watch this', 'device', [box(presetFor('device').safe, 400, 0.55, 2, { fontsReady: false })]);
    expect(captionGlyphsCheck(caption, glyphStub).status).toBe('fail');
  });
});

describe('captionReadability', () => {
  const plan = (frames: number) => qaPlan({ cues: [{ id: 'cue-1', span: { start: 0, end: frames }, probeFrames: [frames >> 1] }] });
  const track = (style = {}) => captions([{ id: 'cue-1', start: 0, frames: 24, text: 'Watch this' }], style);

  it('fails a 0.4 s cue and passes 0.8 s', () => {
    const short = captionReadabilityCheck({ plan: plan(12), captions: track(), target }, new Map());
    expect(short.status).toBe('fail');
    expect(short.fixes).toEqual([{ kind: 'command', labelKey: 'qa.fixes.rebuildCaptions', command: CAPTION_COMMANDS.rebuild, payload: { ...target } }]);
    expect(captionReadabilityCheck({ plan: plan(24), captions: track(), target }, new Map()).status).toBe('pass');
  });

  it('warns on white text without a stroke over white, and passes with a 4 px stroke', () => {
    const white = new Map([['cue-1', '#fafafa']]);
    const bare = captionReadabilityCheck({ plan: plan(24), captions: track(), target }, white);
    expect(bare.status).toBe('warn');
    expect(bare.fixes[0]).toMatchObject({ labelKey: 'qa.fixes.captionStroke', payload: { style: { stroke: { color: '#000000', widthPx: 4 } } } });
    const stroked = track({ stroke: { color: '#000000', widthPx: 4 } });
    expect(captionReadabilityCheck({ plan: plan(24), captions: stroked, target }, white).status).toBe('pass');
  });

  it('fails text under 44 px', () => {
    const result = captionReadabilityCheck({ plan: plan(24), captions: track({ sizePx: 40 }), target }, new Map());
    expect(result.status).toBe('fail');
    expect(result.fixes[0]).toMatchObject({ payload: { style: { sizePx: 44 } } });
  });

  it('measures WCAG contrast', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});
