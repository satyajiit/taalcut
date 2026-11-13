// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The lower third the edit eval's world starts with (HFW1): a composition graphic on from 1 s, its words its `title`
 * variable, with its copy on the timeline, for the graphics cases that reword one or take one off. A made-up design:
 * the cases never draw it.
 */
import { createHash } from 'node:crypto';
import { graphicCompositionSchema, RationalTime, type GraphicItem, type Timeline } from '@taalcut/core';
import { FPS } from './footage';
import { fixedId } from './ids';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const HTML = '<div data-composition-id="lower-third"><p data-var-text="title"></p></div>';

const LOWER_THIRD = graphicCompositionSchema.parse({
  id: fixedId<'GraphicComposition'>('01K8EH', 1),
  version: 1,
  hash: sha(HTML),
  name: 'Lower third',
  entry: 'index.html',
  files: [{ path: 'index.html', sha256: sha(HTML), bytes: Buffer.byteLength(HTML) }],
  variables: [{ type: 'text', name: 'title', maxLength: 40, sample: 'Day one' }],
  durationSeconds: 3.5,
  provenance: { model: null, overlays: [], brief: null, createdAt: 0 },
  gate: {
    version: 'hfw1.1',
    passed: true,
    checkedAt: 0,
    hfLint: { errors: 0, warnings: 0 },
    checks: [],
    loweredTweens: 0,
  },
});

/** The timeline with the lower third on a text track of its own. */
export function withLowerThird(timeline: Timeline): Timeline {
  const item: GraphicItem = {
    type: 'graphic',
    id: fixedId<'TimelineItem'>('01K8EG', 1),
    anchor: { kind: 'time', at: RationalTime.of(30, FPS) },
    start: RationalTime.of(30, FPS),
    duration: RationalTime.of(105, FPS),
    placement: 'middle',
    styleKey: 'graphic',
    language: 'en',
    origin: 'user',
    composition: { id: LOWER_THIRD.id, hash: LOWER_THIRD.hash, params: { title: 'Day one' } },
  };
  return {
    ...timeline,
    tracks: [...timeline.tracks, { kind: 'text', id: 'T2', name: 'Graphics', enabled: true, items: [item] }],
    graphicCompositions: [LOWER_THIRD],
  };
}
