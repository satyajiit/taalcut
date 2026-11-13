// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A made-up landscape reel (as the owner's: a chat bubble beside a speaker's head, the tail toward him) cast from
 * portrait phone clips into a 9:16 video, with a stand-in subject source. No footage; every person is a box.
 */
import {
  RationalTime,
  newId,
  type OverlayDesign,
  type ReelSubjects,
  type ShotProfile,
  type Template,
  type TextItem,
  type TextTrackItem,
  type Timeline,
} from '@taalcut/core';
import { createMemoryShotCatalog } from '../../src/casting/catalog';
import { createCastingEngine } from '../../src/casting/engine';
import { agentWorldOver } from '../fixtures/agent';
import type { World } from '../fixtures/casting';
import { fakeEmbedder, makeProfile, near, unitVector } from '../fixtures/library';
import { buildTemplate } from '../fixtures/template';
import { fakeSubjects, type FakeBox } from './fake-subjects';

export const REEL = { width: 1080, height: 608 };
export const BUBBLE: OverlayDesign = {
  kind: 'chatBubble',
  colors: { fill: '#f7f7f9', text: '#111111', stroke: null },
  cornerRadius: 0.32,
  tail: 'right',
  font: { class: 'sans', weight: 400 },
  motion: { enter: 'none', exit: 'none', typing: false },
  // Left of the reel speaker's head, level with its top.
  shape: { x: 0.24, y: 0.2, width: 0.3, height: 0.09 },
  confidence: 0.9,
};
/** The reel's speaker: right of the bubble. */
export const REEL_HEAD: FakeBox = { x: 0.6, y: 0.08, width: 0.17, height: 0.4 };

export function reelSubjects(template: Template): ReelSubjects {
  const seconds = (template.duration.value * template.duration.rate.den) / template.duration.rate.num;
  const samples = [];
  for (let t = 0; t < seconds; t += 0.25)
    samples.push({
      t: RationalTime.fromSeconds(t, template.canvas.rate),
      heads: [{ box: REEL_HEAD, confidence: 0.9 }],
      people: [],
    });
  return { version: 1, detector: 'vision', hz: 4, samples };
}

export interface ReelWorldOptions {
  readonly text?: string;
  readonly subjects?: boolean;
  readonly profiles?: number;
}

export function reelWorld(options: ReelWorldOptions = {}): World {
  const intents = Array.from({ length: 6 }, (_, index) => unitVector(8_101 + index));
  const built = buildTemplate({
    slots: intents.map((_, index) => ({ frames: 45, text: `shot ${index}` })),
    overlays: [
      // HFW1 retire: the reel's message as a text item where the bubble sat (a graphic is a composition the solver
      // keeps clear of, never places), so the solver's flows run on what it places.
      { start: 0, frames: 60, text: options.text ?? "How's the trip?", slot: 0, box: BUBBLE.shape! },
      { start: 100, frames: 60, text: 'Day one', slot: 2 },
    ],
  });
  const template: Template = {
    ...built,
    canvas: { ...built.canvas, ...REEL },
    ...(options.subjects === false ? {} : { subjects: reelSubjects(built) }),
  };
  const count = options.profiles ?? 18;
  const profiles: ShotProfile[] = Array.from({ length: count }, (_, index) =>
    makeProfile({ embedding: near(intents[index % 6]!, 900 + index, 0.1), orientation: 'portrait' }),
  );
  const table = new Map(intents.map((vector, index) => [`shot ${index}`, vector]));
  const engine = createCastingEngine({
    catalog: createMemoryShotCatalog(profiles),
    embedder: fakeEmbedder(table),
  });
  return { template, profiles, acceptable: [], engine };
}

/** A portrait clip's head where the reel's copied box lands: centred, at the top of the safe area. */
export const CLIP_HEAD: FakeBox = { x: 0.5, y: 0.2, width: 0.26, height: 0.17 };

export function madeWorld(
  heads: (assetId: string, seconds: number) => readonly FakeBox[],
  options: ReelWorldOptions = {},
) {
  const subjects = fakeSubjects(heads);
  const w = agentWorldOver(reelWorld(options), { subjects });
  return { ...w, subjects };
}

export async function assembled(w: ReturnType<typeof madeWorld>): Promise<Timeline> {
  const made = await w.call('timeline.assemble', { projectId: w.projectId, template: { id: w.template.id } });
  if (!made.ok) throw new Error(made.error.code);
  return w.store.docs.get((made.value.timelineIds as string[])[0]!)!;
}

export const itemsOf = (timeline: Timeline): TextTrackItem[] =>
  timeline.tracks.flatMap((track) => (track.kind === 'text' ? track.items : []));

/** The reel's message: the text item where its bubble sat (the first overlay's). */
export const bubbleOf = (timeline: Timeline) =>
  itemsOf(timeline).find((item): item is TextItem => item.type === 'text' && item.start.value === 0)!;

export const projectId = newId<'Project'>();
