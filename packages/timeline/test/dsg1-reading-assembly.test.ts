// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ on a made-up reel: a template whose reading templates composed (a two-message thread, a sign the model
 * calls footage, a doubted title it calls a graphic) settles each overlay: footage out, the doubted title kept, the
 * thread in order. HFW1 retire: DSG1-AUT's components and their kit placement went with the kit; the messages are
 * designed as compositions (the template's design) from these briefs.
 */
import { describe, expect, it } from 'vitest';
import { type OverlayDesign, type ShotProfile, type Template, type TextOverlay } from '@taalcut/core';
import {
  GRAPHIC_BRIEF_PROMPT,
  graphicReading,
  readGraphicAnswer,
  withGraphicReading,
} from '@taalcut/templates';
import { createMemoryShotCatalog } from '../src/casting/catalog';
import { createCastingEngine } from '../src/casting/engine';
import { fakeEmbedder, makeProfile, near, unitVector } from './fixtures/library';
import { buildTemplate } from './fixtures/template';
import { REEL } from './placement/reel-world';

const QUESTION: OverlayDesign = {
  kind: 'chatBubble',
  colors: { fill: '#f7f7f9', text: '#111111', stroke: null },
  cornerRadius: 0.32,
  tail: 'right',
  font: { class: 'sans', weight: 400 },
  motion: { enter: 'none', exit: 'none', typing: true },
  shape: { x: 0.3, y: 0.18, width: 0.3, height: 0.09 },
  confidence: 0.9,
};
const REPLY: OverlayDesign = {
  ...QUESTION,
  colors: { fill: '#d9fdd3', text: '#111111', stroke: null },
  tail: 'left',
  receipt: true,
  motion: { enter: 'none', exit: 'none', typing: false },
  shape: { x: 0.24, y: 0.3, width: 0.26, height: 0.09 },
};

function readTemplate() {
  const intents = Array.from({ length: 6 }, (_, index) => unitVector(9_301 + index));
  const built = buildTemplate({
    slots: intents.map((_, index) => ({ frames: 45, text: `shot ${index}` })),
    overlays: [
      { start: 0, frames: 170, text: 'Made-up question?', slot: 0, design: QUESTION },
      { start: 60, frames: 110, text: 'Made-up reply', slot: 1, design: REPLY },
      { start: 100, frames: 40, text: 'MADE-UP STREET', slot: 2 },
      { start: 180, frames: 60, text: 'Day one', slot: 4 },
    ],
  });
  const doubted = new Set(['MADE-UP STREET', 'Day one']);
  const text: TextOverlay[] = built.text.map((overlay) => ({
    ...overlay,
    ...(overlay.design?.shape ? { box: overlay.design.shape } : {}),
    ...(doubted.has(overlay.text)
      ? { doubts: [{ reason: 'textMaybeScene' as const, confidence: 0.5 }] }
      : {}),
  }));
  const template: Template = { ...built, canvas: { ...built.canvas, ...REEL }, text };
  const said: Record<string, object> = {
    'Made-up question?': { graphic: true, kind: 'incomingMessage', role: 'question' },
    'Made-up reply': { graphic: true, kind: 'outgoingMessage', role: 'answer', answers: 1 },
    'MADE-UP STREET': { graphic: false, reason: 'A street sign on the wall', kind: 'label' },
    'Day one': { graphic: true, kind: 'title', role: 'context' },
  };
  const answers = Object.fromEntries(
    text.map((overlay) => [overlay.id, readGraphicAnswer(JSON.stringify(said[overlay.text]))!]),
  );
  const reading = graphicReading(
    template,
    { graphicSheets: text.map((overlay) => ({ overlayId: overlay.id, path: 'graphics/x.png', frames: [] })) },
    { prompt: GRAPHIC_BRIEF_PROMPT, model: { provider: 'stand-in', model: 'reader', local: true }, answers },
  );
  const read = withGraphicReading(template, reading);
  const byText = (words: string) => read.text.find((overlay) => overlay.text === words)!;
  const profiles: ShotProfile[] = Array.from({ length: 18 }, (_, index) =>
    makeProfile({ embedding: near(intents[index % 6]!, 700 + index, 0.1), orientation: 'portrait' }),
  );
  const engine = createCastingEngine({
    catalog: createMemoryShotCatalog(profiles),
    embedder: fakeEmbedder(new Map(intents.map((vector, index) => [`shot ${index}`, vector]))),
  });
  return { template: read, byText, profiles, engine };
}

describe('the reading of a reel’s graphics', () => {
  it('the reading settles each overlay: footage out, the doubted title kept, the thread in order', () => {
    const { template, byText } = readTemplate();
    const reading = template.graphics!.reading!;
    expect(reading.system.conversation).toEqual([
      { overlayId: byText('Made-up question?').id, side: 'right', speaker: 'them' },
      { overlayId: byText('Made-up reply').id, side: 'left', speaker: 'me' },
    ]);
    expect(reading.system.stack?.direction).toBe('down');
    expect(byText('MADE-UP STREET').doubts).toBeUndefined();
    expect(byText('Day one').doubts).toBeUndefined();
  });
});
