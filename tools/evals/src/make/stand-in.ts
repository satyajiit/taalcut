// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: eval:make's stand-in model, for the harness itself (its test, and `--stand-in`): a script per case of
 * the calls a model that reads the fixes would make, written from the world as it is at each turn (ids, revision).
 * It drafts, makes the fixes, drafts again and finishes; a case without a script only drafts and finishes, so
 * video.done's refusal is what it sees.
 */
import { ok } from '@taalcut/core';
import type { DesignerCall, DesignerModel } from '@taalcut/render';
import { FPS, shotByKey } from './footage';
import type { MakeWorld } from './world';

type Step = (world: MakeWorld) => Omit<DesignerCall, 'id'>[];

const target = (world: MakeWorld) => ({ projectId: world.projectId, timelineId: world.timelineId });
const revision = (world: MakeWorld) => world.timeline().revision;
const clipAt = (world: MakeWorld, index: number) => {
  const v1 = world.timeline().tracks[0]!;
  return v1.items.filter((item) => item.type === 'clip')[index]!.id;
};
const graphicAt = (world: MakeWorld, index: number) =>
  world.timeline().tracks.flatMap((track) => (track.kind === 'text' ? track.items : []))[index]!.id;

const draft: Step = (world) => [
  { name: 'render.draft', arguments: { ...target(world), revision: revision(world) } },
];
const done: Step = (world) => [{ name: 'video.done', arguments: target(world) }];
const swap =
  (index: number, key: string, seconds: number, from: 'alternate' | 'search' = 'alternate'): Step =>
  (world) => {
    const shot = shotByKey(key);
    return [
      {
        name: 'timeline.swapClip',
        arguments: {
          ...target(world),
          clipId: clipAt(world, index),
          revision: revision(world),
          media: { assetId: shot.assetId, shotId: shot.shotId },
          sourceStart: { value: Math.round(seconds * 30), rate: FPS },
          from,
        },
      },
    ];
  };

const SCRIPTS: Readonly<Record<string, readonly Step[]>> = {
  'phone-hook': [
    draft,
    swap(0, 'phone', 5, 'search'),
    swap(2, 'run', 1),
    (world) => [
      {
        name: 'graphics.design',
        arguments: {
          ...target(world),
          request: 'The reel’s chat bubble, where the reel has it',
          itemIds: [graphicAt(world, 0)],
        },
      },
    ],
    draft,
    done,
  ],
  'morning-chat': [
    draft,
    swap(0, 'coffee', 1),
    swap(1, 'laugh', 1),
    (world) => [
      {
        name: 'graphics.design',
        arguments: { ...target(world), request: 'The reel’s reply bubble', at: 4.7 },
      },
    ],
    draft,
    done,
  ],
  'beach-run': [
    draft,
    () => [{ name: 'library.search', arguments: { query: 'a dog running on sand' } }],
    swap(1, 'bus', 1),
    draft,
    (world) => [
      {
        name: 'video.done',
        arguments: { ...target(world), reasons: [{ slot: 1, reason: 'No footage shows a dog on sand' }] },
      },
    ],
  ],
};

export function standInMaker(world: MakeWorld): DesignerModel {
  const steps = SCRIPTS[world.id] ?? [draft, done];
  let turn = 0;
  return {
    seesImages: false,
    async turn() {
      const step = steps[turn++];
      const calls = step
        ? step(world).map((call, index) => ({ ...call, id: `stand-in-${turn}-${index}` }))
        : [];
      return ok({ text: step ? '' : 'Done.', calls, model: 'stand-in/make', local: true });
    },
  };
}
