// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 tpl: the make's fill. An overlay whose template use names a composition is drawn with it, its words set to
 * the new ones in the composition's first text variable and nothing measured (no size, no width, no kit fields);
 * the timeline keeps a copy of each composition once; the solver never scales one; and a make puts the template's
 * composition files from the pool into its project, leaving out a composition whose files it couldn't put.
 */
import { describe, expect, it } from 'vitest';
import {
  err,
  newId,
  NotFoundError,
  ok,
  textTrackItemSchema,
  type GraphicComposition,
  type GraphicItem,
  type OverlayDesign,
  type Template,
  type TextTrackItem,
  type Timeline,
} from '@taalcut/core';
import { compositionsUsed, filledParams } from '../src/assembly/designed';
import { withCompositionFiles } from '../src/assembly/composition-files';
import { textTracksFor } from '../src/assembly/text';
import { buildTemplate } from './fixtures/template';

const ids = { item: () => newId<'TimelineItem'>() };
const sha = (c: string) => c.repeat(64);

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

const composition = (name: string, file: string): GraphicComposition => ({
  id: newId<'GraphicComposition'>(),
  version: 1,
  hash: sha(file === 'a' ? 'c' : 'd'),
  name,
  entry: 'index.html',
  files: [{ path: 'index.html', sha256: sha(file), bytes: 100 }],
  variables: [{ type: 'text', name: 'message', maxLength: 200, sample: 'Made-up question here?' }],
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

function made() {
  const base = buildTemplate({
    slots: [{ frames: 60 }, { frames: 90 }],
    overlays: [
      { start: 30, frames: 90, text: 'Made-up question here?', slot: 0, design: BUBBLE },
      {
        start: 60,
        frames: 75,
        text: 'Sounds good to me',
        slot: 1,
        design: { ...BUBBLE, tail: 'right', receipt: true },
      },
    ],
  });
  const incoming = composition('Incoming bubble', 'a');
  const reply = composition('Reply bubble', 'b');
  const [question, answer] = base.text;
  const template: Template = {
    ...base,
    graphics: {
      compositions: [incoming, reply],
      uses: [
        {
          overlayId: question!.id,
          compositionId: incoming.id,
          params: { message: 'Made-up question here?' },
        },
        { overlayId: answer!.id, compositionId: reply.id, params: { message: 'Sounds good to me' } },
      ],
    },
  };
  return { template, incoming, reply };
}

const graphics = (tracks: readonly { readonly items: readonly TextTrackItem[] }[]) =>
  tracks.flatMap((track) => track.items).filter((item): item is GraphicItem => item.type === 'graphic');

// Made-up new words, 25–40 % longer than the reel's.
const NEW_QUESTION = 'Made-up question for you, ok?';
const NEW_REPLY = 'Sounds really good to me';

describe('the make’s fill (HFW1 tpl)', () => {
  it('draws each overlay with its composition and the new words, and measures nothing', () => {
    const { template, incoming, reply } = made();
    const [question, answer] = template.text;
    const items = graphics(
      textTracksFor(template, { [question!.id]: NEW_QUESTION, [answer!.id]: NEW_REPLY }, ids),
    );
    for (const item of items) expect(textTrackItemSchema.safeParse(item).success).toBe(true);
    expect(items.map((item) => item.composition)).toEqual([
      { id: incoming.id, hash: incoming.hash, params: { message: NEW_QUESTION } },
      { id: reply.id, hash: reply.hash, params: { message: NEW_REPLY } },
    ]);
    for (const item of items) {
      expect(item).not.toHaveProperty('fields');
      expect(item).not.toHaveProperty('componentVersion');
      expect(item).not.toHaveProperty('component');
      expect(item).not.toHaveProperty('scale');
    }
    // On the reel's time and beat, where the reel's sat.
    expect(items[0]!.start.value).toBe(30);
    expect(items[0]!.placement).toEqual({ box: BUBBLE.shape });
    expect(items[1]!.overlay).toEqual({ id: answer!.id, words: 'editor' });
    expect(compositionsUsed(template, items).map((copy) => copy.id)).toEqual([incoming.id, reply.id]);
  });

  it('puts only the words into the first text variable, keeping the use’s other values', () => {
    const { incoming } = made();
    expect(filledParams(incoming, { message: 'old', top: 730 }, 'new words')).toEqual({
      message: 'new words',
      top: 730,
    });
    expect(filledParams({ ...incoming, variables: [] }, { top: 730 }, 'new words')).toEqual({ top: 730 });
  });

  it('puts a make’s composition files into its project, and leaves out one it can’t', async () => {
    const { template, incoming, reply } = made();
    const items = graphics(textTracksFor(template, {}, ids));
    const timeline = {
      tracks: [
        { kind: 'video', id: 'V1', name: 'V1', enabled: true, items: [] },
        { kind: 'text', id: 'T1', name: 'T1', enabled: true, items },
      ],
      graphicCompositions: [incoming, reply],
    } as unknown as Timeline;
    const put: string[] = [];
    const store = {
      readTemplateBlob: async (sha256: string) =>
        sha256 === sha('a')
          ? ok(new Uint8Array([1]))
          : err(NotFoundError({ entity: 'workspaceBlob', id: sha256 })),
      putBlob: async (_projectId: unknown, data: Uint8Array) => {
        put.push(String(data[0]));
        return ok({ sha256: sha('a'), bytes: data.length });
      },
    };
    const projectId = newId<'Project'>();
    const filled = await withCompositionFiles(store, projectId, [timeline]);
    expect(put).toEqual(['1']);
    expect(filled.timelines[0]!.graphicCompositions).toEqual([incoming]);
    expect(
      graphics(filled.timelines[0]!.tracks.filter((track) => track.kind === 'text') as never).map(
        (item) => item.composition!.id,
      ),
    ).toEqual([incoming.id]);
    expect(filled.warnings).toEqual([
      'Reply bubble: its files could not be put into the project, so its graphics are left out',
    ]);
    // Without a store nothing can be drawn: every composition graphic is left out.
    const none = await withCompositionFiles(undefined, projectId, [timeline]);
    expect(none.timelines[0]!.graphicCompositions).toBeUndefined();
  });
});
