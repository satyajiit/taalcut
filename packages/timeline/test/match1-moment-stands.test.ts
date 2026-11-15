// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MATCH1: a stated moment's in-point stands through the one step of an assembly that moves in-points by itself.
 * The step with the person (FIX-TRIM) moves a walking slot's clip past where the person starts to walk: it is
 * shown moving the clip first, then leaving it where the statement put it. (Placement changes no clip since TXT1.)
 */
import type { Clip, Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createMemoryShotCatalog } from '../src/casting/catalog';
import { createCastingEngine } from '../src/casting/engine';
import { agentWorldOver } from './fixtures/agent';
import { fakeEmbedder, unitVector } from './fixtures/library';
import { fakeSubjects as fakePeople, pushInShot, standsThenWalks } from './fixtures/people';
import { buildTemplate } from './fixtures/template';

const clipOf = (timeline: Timeline, slotId: string): Clip =>
  timeline.tracks
    .flatMap((track) => (track.kind === 'video' ? track.items : []))
    .find((item): item is Clip => item.type === 'clip' && item.slotId === slotId)!;

describe('a stated moment and the step with the person (MATCH1)', () => {
  /** FIX-TRIM's world: a walking slot, and a shot whose person stands for 3 s and then walks. */
  function walking() {
    const built = buildTemplate({
      slots: [
        { frames: 15 },
        { frames: 30, text: 'Walking down a busy street', anchor: false },
        { frames: 15 },
      ],
    });
    // The walking slot states a moment for its start.
    const lands = { edge: 'start', moment: 'They look up' } as const;
    const template = {
      ...built,
      slots: built.slots.map((slot, index) => (index === 1 ? { ...slot, lands } : slot)),
    };
    const profiles = [
      pushInShot(6, { bestFrame: 9, embedding: unitVector(21) }),
      pushInShot(4, { embedding: unitVector(22) }),
      pushInShot(4, { embedding: unitVector(23) }),
    ];
    const table = new Map(
      template.slots.map((slot, index) => [slot.intent.text, profiles[(index + 2) % 3]!.embedding]),
    );
    const engine = createCastingEngine({
      catalog: createMemoryShotCatalog(profiles),
      embedder: fakeEmbedder(table),
    });
    const walker = profiles[0]!;
    const people = fakePeople(new Map([[walker.assetId as string, standsThenWalks(3)]]));
    const w = agentWorldOver({ template, profiles, acceptable: [], engine }, { subjects: people.source });
    const slotId = template.slots[1]!.id as string;
    async function made(extra: Record<string, unknown> = {}) {
      const answer = await w.call('timeline.assemble', {
        projectId: w.projectId,
        template: { id: template.id },
        ...extra,
      });
      if (!answer.ok) throw new Error(answer.error.code);
      const timeline = w.store.docs.get((answer.value.timelineIds as string[])[0]!)!;
      return { answer: answer.value, clip: clipOf(timeline, slotId) };
    }
    return { walker, slotId, made };
  }

  it('the step moves the walking slot’s clip past the person’s start; a stated moment stays where it was put', async () => {
    const { walker, slotId, made } = walking();
    const plain = await made();
    expect(plain.clip.media.assetId).toBe(walker.assetId);
    // Half a second into the walk at least: the step with the person ran and moved it.
    expect(plain.clip.sourceStart.value).toBeGreaterThanOrEqual(105);

    // The AI states the instant at 2 s (the person still stands there): the slot starts on it all the same.
    const stated = await made({ parts: [{ slotId, shotId: walker.shotId, from: 2 }] });
    expect(stated.clip.sourceStart.value).toBe(60);
    expect(stated.clip.locked).toBe(false);
    expect(stated.answer.moments).toMatchObject([{ landed: true, videoSeconds: 0.5, playsShotFrom: 2 }]);
  });
});
