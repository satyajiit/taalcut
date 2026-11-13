// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-GFX and HFW1: assembly draws a reel's designed overlay with the composition its template holds for it, on the
 * overlay's time and beat; a graphic overlay with no composition is left out (HFW1 retire: no built-in graphic stands
 * in); one without a design, read with little confidence or plain stays text, and so does a designed one on too
 * briefly. The Editor's timeline.editText is for text items: a graphic's words are its design's (graphics.edit).
 */
import { describe, expect, it } from 'vitest';
import {
  newId,
  RationalTime,
  textTrackItemSchema,
  type GraphicComposition,
  type GraphicItem,
  type OverlayDesign,
  type Template,
  type TextTrackItem,
} from '@taalcut/core';
import { DESIGN_CONFIDENCE_FLOOR, onBeat } from '../src/assembly/designed';
import { textTracksFor } from '../src/assembly/text';
import { editText } from '../src/edits/text';
import { buildTemplate } from './fixtures/template';
import { buildTimeline } from './fixtures/timeline';

const ids = { item: () => newId<'TimelineItem'>() };

const BUBBLE: OverlayDesign = {
  kind: 'chatBubble',
  colors: { fill: '#f7f7f9', text: '#111111', stroke: null },
  cornerRadius: 0.32,
  tail: 'right',
  font: { class: 'sans', weight: 400 },
  motion: { enter: 'none', exit: 'none', typing: false },
  shape: { x: 0.1, y: 0.4, width: 0.36, height: 0.07 },
  confidence: 0.86,
};
const LABEL: OverlayDesign = {
  ...BUBBLE,
  kind: 'label',
  colors: { fill: '#000000', text: '#ffffff', stroke: null },
  cornerRadius: 0.1,
  tail: 'none',
  motion: { enter: 'pop', exit: 'pop', typing: false },
};

function template() {
  return buildTemplate({
    slots: [{ frames: 60 }, { frames: 60 }, { frames: 60 }],
    overlays: [
      { start: 9, frames: 110, text: 'Made-up question?', slot: 0, design: BUBBLE },
      {
        start: 46,
        frames: 40,
        text: 'Made-up answer',
        slot: 0,
        design: { ...BUBBLE, tail: 'left', receipt: true },
      },
      { start: 60, frames: 45, text: 'Day one', slot: 1, design: LABEL },
      {
        start: 120,
        frames: 40,
        text: 'Plain words',
        slot: 2,
        design: { ...LABEL, kind: 'plain', colors: { ...LABEL.colors, fill: null } },
      },
      {
        start: 125,
        frames: 40,
        text: 'Unsure',
        slot: 2,
        design: { ...LABEL, confidence: DESIGN_CONFIDENCE_FLOOR - 0.1 },
      },
      { start: 150, frames: 20, text: 'Too quick', slot: 2, design: LABEL },
      { start: 165, frames: 15, text: 'No design', slot: 2 },
    ],
  });
}

const sha = (c: string) => c.repeat(64);
const composition = (): GraphicComposition => ({
  id: newId<'GraphicComposition'>(),
  version: 1,
  hash: sha('c'),
  name: 'Made-up bubble',
  entry: 'index.html',
  files: [{ path: 'index.html', sha256: sha('a'), bytes: 100 }],
  variables: [{ type: 'text', name: 'message', maxLength: 200, sample: 'Made-up words' }],
  durationSeconds: 3,
  provenance: { model: { id: 'stand-in', onDevice: false }, overlays: [], brief: null, createdAt: 1 },
  gate: {
    version: 'hfw1.1',
    passed: true,
    checkedAt: 1,
    hfLint: { errors: 0, warnings: 0 },
    checks: [],
    loweredTweens: 1,
  },
});

/** The template with one composition drawing its graphic overlays (the first three and "Too quick"). */
function designed(): Template {
  const base = template();
  const copy = composition();
  const drawn = [0, 1, 2, 5].map((index) => base.text[index]!.id);
  return {
    ...base,
    graphics: {
      uses: drawn.map((overlayId) => ({ overlayId, compositionId: copy.id, params: {} })),
      compositions: [copy],
    },
  } as Template;
}

const all = (tracks: readonly { readonly items: readonly TextTrackItem[] }[]) =>
  tracks.flatMap((track) => track.items);
const graphics = (items: readonly TextTrackItem[]) =>
  items.filter((item): item is GraphicItem => item.type === 'graphic');

describe('a designed overlay in assembly', () => {
  it('is drawn with its composition; with none, a graphic overlay is left out; the rest stay text', () => {
    const made = designed();
    const items = all(textTracksFor(made, {}, ids));
    for (const item of items) expect(textTrackItemSchema.safeParse(item).success).toBe(true);
    const drawn = graphics(items);
    expect(drawn).toHaveLength(3);
    const texts = (list: readonly TextTrackItem[]) =>
      list
        .filter((item) => item.type === 'text')
        .map((item) => (item.type === 'text' ? item.text : ''))
        .sort();
    // "Too quick" is on too briefly for a graphic: it stays text.
    expect(texts(items)).toEqual(['No design', 'Plain words', 'Too quick', 'Unsure']);
    const [question] = drawn;
    expect(question!.composition?.params).toEqual({ message: 'Made-up question?' });
    expect(question!.placement).toEqual({ box: BUBBLE.shape });
    expect(question!.overlay).toEqual({ id: made.text[0]!.id, words: 'template' });
    expect(question).not.toHaveProperty('fields');
    // HFW1 retire: without the template's compositions, no graphic and no bare words where the reel had a shape.
    const bare = all(textTracksFor(template(), {}, ids));
    expect(graphics(bare)).toEqual([]);
    expect(texts(bare)).toEqual(['No design', 'Plain words', 'Unsure']);
  });

  it('plays on the overlay’s time, on its beat when one is two frames away, on its slot when it starts it', () => {
    const made = designed();
    const [question, answer, label] = graphics(all(textTracksFor(made, {}, ids)));
    // Frame 9 is 9 from a beat: kept. Frame 46 is a frame after the beat at 45: moved onto it, its end kept.
    expect(question!.start).toEqual(RationalTime.of(9, made.canvas.rate));
    expect(question!.duration.value).toBe(110);
    expect(question!.anchor).toEqual({ kind: 'time', at: RationalTime.of(9, made.canvas.rate) });
    expect(answer!.start.value).toBe(45);
    expect(answer!.start.value + answer!.duration.value).toBe(86);
    expect(label!.anchor).toEqual({ kind: 'slot', slotId: made.slots[1]!.id });
    expect(onBeat(46, made.beatMap, made.canvas.rate)).toBe(45);
    expect(onBeat(52, made.beatMap, made.canvas.rate)).toBe(52);
    expect(onBeat(46, null, made.canvas.rate)).toBe(46);
  });

  it('carries the Editor’s rewrite as its words', () => {
    const made = designed();
    const rewrites = { [made.text[0]!.id]: 'How was Goa?' };
    const bubble = graphics(all(textTracksFor(made, rewrites, ids))).find(
      (item) => item.overlay?.id === made.text[0]!.id,
    );
    expect(bubble?.composition?.params).toEqual({ message: 'How was Goa?' });
    expect(bubble?.overlay?.words).toBe('editor');
  });

  it('leaves out text that may be part of the scene while the doubt stands', () => {
    const made = designed();
    const doubted = {
      ...made,
      text: made.text.map((overlay, index) =>
        index === 6
          ? { ...overlay, doubts: [{ reason: 'textMaybeScene' as const, confidence: 0.7 }] }
          : overlay,
      ),
    };
    const items = all(textTracksFor(doubted, {}, ids));
    expect(items).toHaveLength(6);
    expect(items.some((item) => item.type === 'text' && item.text === 'No design')).toBe(false);
  });

  it('leaves out text the reading of the reel’s graphics calls footage, until it is restored (DSG1-READ)', () => {
    const made = template();
    const sign = made.text[6]!;
    const footage = (graphic: boolean) => ({
      ...made,
      graphics: {
        uses: [],
        reading: {
          version: 1 as const,
          prompt: 'graphic-brief/1',
          model: null,
          briefs: [
            {
              overlayId: sign.id,
              graphic,
              reason: graphic ? null : 'A sign on the wall',
              kind: 'other' as const,
              what: 'a sign',
              role: 'other' as const,
              answers: null,
              look: { words: '', platform: 'neutral' as const, shadow: false, avatar: false },
              motion: { words: '', typingSeconds: null },
              timing: { cue: 'free' as const, words: '' },
              people: { words: '' },
              source: 'model' as const,
              confidence: 0.8,
            },
          ],
          system: {
            tokens: { platform: 'neutral' as const, fills: [], text: [], cornerRadius: null, font: null },
            conversation: [],
            stack: null,
            words: '',
          },
        },
      },
    });
    const has = (graphic: boolean) =>
      all(textTracksFor(footage(graphic), {}, ids)).some(
        (item) => item.type === 'text' && item.overlayId === sign.id,
      );
    expect(has(false)).toBe(false);
    expect(has(true)).toBe(true);
  });
});

describe('the Editor and a drawn overlay', () => {
  it('timeline.editText names text items only: a graphic’s words are its design’s', () => {
    const tracks = textTracksFor(designed(), {}, ids);
    const base = buildTimeline({ clips: [{ frames: 60 }, { frames: 60 }, { frames: 60 }] }).timeline;
    const timeline = { ...base, tracks: [base.tracks[0]!, ...tracks] };
    const itemId = graphics(all(tracks))[0]!.id;
    const result = editText(timeline, { itemId, text: 'How was Goa?' }, { source: 'agent' });
    expect(result).toMatchObject({ ok: false, error: { code: 'timeline.item_not_found' } });
    expect((result.ok ? '' : (result.error.detail ?? '')).split('Its text items:')[1]).not.toContain(itemId);
  });
});
