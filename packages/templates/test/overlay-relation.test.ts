// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-OVL: the breakdown records each designed overlay's relation to the reel's people (`design.placement`):
 * which side of the nearest real head it sat on and how far, or the frame's band when nobody was near. Passers-by
 * (small heads) and unsure heads don't count; an overlay with a relation already, or plain text, is left alone;
 * without the reel's subjects nothing changes. Boxes are made up.
 */
import { describe, expect, it } from 'vitest';
import {
  FrameRate,
  newId,
  RationalTime,
  type OverlayDesign,
  type ReelSubjects,
  type Template,
  type TextOverlay,
} from '@taalcut/core';
import {
  overlayRelation,
  withOverlayRelations,
  withPlacementRelations,
  zoneOfBox,
} from '../src/breakdown/overlay-relation';
import { referenceTemplate } from './helpers/fixtures';

const RATE = FrameRate.of(30);
const PORTRAIT = { width: 1080, height: 1920 };
const head = { x: 0.55, y: 0.25, width: 0.25, height: 0.14 };
const sample = (seconds: number, heads = [head], confidence = 0.9) => ({
  t: RationalTime.fromSeconds(seconds, RATE),
  heads: heads.map((box) => ({ box, confidence })),
  people: [],
});
const subjects = (samples = [sample(0), sample(0.5), sample(1)]): ReelSubjects => ({
  version: 1,
  detector: 'vision',
  hz: 2,
  samples,
});

const DESIGN: OverlayDesign = {
  kind: 'chatBubble',
  colors: { fill: '#f7f7f9', text: '#111111', stroke: null },
  cornerRadius: 0.32,
  tail: 'right',
  font: { class: 'sans', weight: 400 },
  motion: { enter: 'none', exit: 'none', typing: false },
  shape: { x: 0.1, y: 0.27, width: 0.38, height: 0.06 },
  confidence: 0.9,
};

function overlay(design: OverlayDesign | null = DESIGN): TextOverlay {
  return {
    id: newId<'TextOverlay'>(),
    text: 'Made-up words',
    role: 'label',
    start: RationalTime.of(0, RATE),
    duration: RationalTime.of(30, RATE),
    slotId: null,
    box: design?.shape ?? { x: 0.1, y: 0.8, width: 0.8, height: 0.05 },
    appearance: referenceAppearance(),
    styleKey: 'callout',
    reveal: 'cut',
    ...(design ? { design } : {}),
    language: 'en',
    confidence: 0.9,
  } as unknown as TextOverlay;
}

const referenceAppearance = () =>
  ({
    size: 0.03,
    weight: 'regular',
    case: 'sentence',
    color: '#ffffff',
    background: 'none',
    align: 'center',
  }) as unknown as TextOverlay['appearance'];

describe('an overlay’s relation to the reel’s people', () => {
  it('a bubble left of the speaker’s head: beside it, on the left, close', () => {
    const relation = overlayRelation(DESIGN.shape!, subjects().samples, PORTRAIT);
    expect(relation).toMatchObject({ relativeTo: 'subject', side: 'left', zone: 'top' });
    expect(relation.gap).toBeLessThan(1);
  });

  it('above and below a head', () => {
    const above = { x: 0.5, y: 0.12, width: 0.4, height: 0.05 };
    const below = { x: 0.5, y: 0.45, width: 0.4, height: 0.05 };
    expect(overlayRelation(above, subjects().samples, PORTRAIT).side).toBe('above');
    expect(overlayRelation(below, subjects().samples, PORTRAIT).side).toBe('below');
  });

  it('far from everyone: the frame’s band', () => {
    const caption = { x: 0.1, y: 0.82, width: 0.8, height: 0.05 };
    expect(overlayRelation(caption, subjects().samples, PORTRAIT)).toEqual({
      relativeTo: 'frame',
      zone: 'bottom',
    });
    expect(zoneOfBox({ x: 0, y: 0.4, width: 1, height: 0.1 })).toBe('middle');
  });

  it('a passer-by’s small head and an unsure head don’t count', () => {
    const small = { x: 0.52, y: 0.27, width: 0.05, height: 0.03 };
    expect(overlayRelation(DESIGN.shape!, [sample(0, [small])], PORTRAIT).relativeTo).toBe('frame');
    expect(overlayRelation(DESIGN.shape!, [sample(0, [head], 0.1)], PORTRAIT).relativeTo).toBe('frame');
  });
});

describe('recording relations', () => {
  it('records designed overlays’, leaving plain text and recorded ones alone', () => {
    const recorded = overlay({ ...DESIGN, placement: { relativeTo: 'frame', zone: 'middle' } });
    const plain = overlay(null);
    const [bubble, kept, text] = withPlacementRelations([overlay(), recorded, plain], subjects(), PORTRAIT);
    expect(bubble?.design?.placement).toMatchObject({ relativeTo: 'subject', side: 'left' });
    expect(kept).toBe(recorded);
    expect(text).toBe(plain);
  });

  it('without the reel’s subjects nothing changes', () => {
    const overlays = [overlay()];
    expect(withPlacementRelations(overlays, undefined, PORTRAIT)[0]).toBe(overlays[0]);
    const template = referenceTemplate();
    expect(withOverlayRelations(template)).toBe(template);
  });

  it('a built template with the reel’s subjects records them', () => {
    const template: Template = {
      ...referenceTemplate(),
      canvas: { ...referenceTemplate().canvas, ...PORTRAIT },
      text: [overlay()],
      subjects: subjects(),
    };
    expect(withOverlayRelations(template).text[0]?.design?.placement?.side).toBe('left');
  });
});
