// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 tpl: the placement solver never scales a composition. The FRM1 owner's case made up again, a bubble beside
 * the speaker's head: drawn with the template's composition, `timeline.assemble` keeps it where the reel's sat and
 * its words in its variable, with no solver box, reason or scale. Keeping clear of the head is the frame checks'
 * job, which send the frame back to the Designer.
 */
import { describe, expect, it } from 'vitest';
import { newId, ok, type GraphicComposition, type GraphicItem, type Template } from '@taalcut/core';
import { agentWorldOver } from '../fixtures/agent';
import { fakeSubjects } from './fake-subjects';
import { assembled, BUBBLE, CLIP_HEAD, itemsOf, reelWorld } from './reel-world';

const sha = (c: string) => c.repeat(64);
const composition: GraphicComposition = {
  id: newId<'GraphicComposition'>(),
  version: 1,
  hash: sha('c'),
  name: 'Incoming bubble',
  entry: 'index.html',
  files: [{ path: 'index.html', sha256: sha('a'), bytes: 1 }],
  variables: [{ type: 'text', name: 'message', maxLength: 200, sample: "How's the trip?" }],
  durationSeconds: 2,
  provenance: { model: { id: 'stand-in', onDevice: false }, overlays: [], brief: null, createdAt: 1 },
  gate: {
    version: 'hfw1.1',
    passed: true,
    checkedAt: 1,
    hfLint: { errors: 0, warnings: 0 },
    checks: [],
    loweredTweens: 1,
  },
};

describe('a composition and the placement solver (HFW1 tpl)', () => {
  it('is never scaled or moved by the solver: it lays itself out', async () => {
    const base = reelWorld();
    // The reel drew its message as a bubble: a graphic overlay, drawn with the template's composition.
    const overlay = { ...base.template.text[0]!, design: BUBBLE };
    const template: Template = {
      ...base.template,
      text: [overlay, ...base.template.text.slice(1)],
      graphics: {
        compositions: [composition],
        uses: [{ overlayId: overlay.id, compositionId: composition.id, params: { message: overlay.text } }],
      },
    };
    const put: string[] = [];
    const workspace = {
      readTemplateBlob: async () => ok(new Uint8Array([7])),
      putBlob: async (_projectId: unknown, data: Uint8Array) => {
        put.push(String(data[0]));
        return ok({ sha256: sha('a'), bytes: 1 });
      },
    };
    const subjects = fakeSubjects(() => [CLIP_HEAD]);
    const w = agentWorldOver({ ...base, template }, { subjects, workspace });
    const timeline = await assembled({ ...w, subjects });
    const bubble = itemsOf(timeline).find((item): item is GraphicItem => item.type === 'graphic')!;
    expect(bubble.composition).toEqual({
      id: composition.id,
      hash: composition.hash,
      params: { message: overlay.text },
    });
    expect(bubble.scale).toBeUndefined();
    expect(typeof bubble.placement === 'object' && bubble.placement.reason).toBeFalsy();
    expect(timeline.graphicCompositions).toEqual([composition]);
    expect(put).toEqual(['7']);
  });
});
