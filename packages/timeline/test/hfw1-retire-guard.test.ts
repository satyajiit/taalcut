// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-TPL, the retire step's guard for the make: a template overlay is drawn with the composition its Designer made,
 * or not drawn at all. With no composition there is no kit graphic to fall back to (the owner: "we should never hard
 * code any components that is needed for the video"). The exports' half is desktop's `test/hfw1-retire-guard.test.ts`.
 *
 * On since the retire commit (the coordinator, 2026-11-03: off until dsn's Designer and `graphics.design` landed).
 */
import { describe, expect, it } from 'vitest';
import { newId, type GraphicItem, type OverlayDesign, type TextTrackItem } from '@taalcut/core';
import { textTracksFor } from '../src/assembly/text';
import { buildTemplate } from './fixtures/template';

const RETIRED = true;

const BUBBLE: OverlayDesign = {
  kind: 'chatBubble',
  colors: { fill: '#ffffff', text: '#111111', stroke: null },
  cornerRadius: 0.36,
  tail: 'left',
  font: { class: 'sans', weight: 400 },
  motion: { enter: 'pop', exit: 'none', typing: false },
  shape: { x: 0.06, y: 0.38, width: 0.43, height: 0.045 },
  confidence: 0.9,
};

const graphics = (tracks: readonly { readonly items: readonly TextTrackItem[] }[]) =>
  tracks.flatMap((track) => track.items).filter((item): item is GraphicItem => item.type === 'graphic');

describe.skipIf(!RETIRED)('the retire step’s guard for the make (HFW1 tpl)', () => {
  it('draws no graphic for an overlay its template has no composition for', () => {
    const template = buildTemplate({
      slots: [{ frames: 90 }],
      overlays: [{ start: 15, frames: 60, text: 'Made-up question here?', slot: 0, design: BUBBLE }],
    });
    const [question] = template.text;
    const made = textTracksFor(
      template,
      { [question!.id]: 'Made-up question for you here?' },
      {
        item: () => newId<'TimelineItem'>(),
      },
    );
    expect(graphics(made)).toEqual([]);
  });
});
