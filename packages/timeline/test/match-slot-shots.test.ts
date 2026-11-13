// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: each draft clip's shot against the slot it fills, read from made-up profiles: its measured camera move
 * and its slot's needs, weighed against the draft's shots and the cast's alternates.
 */
import { describe, expect, it } from 'vitest';
import { ok, type Clip, type ShotProfile, type Template, type Timeline } from '@taalcut/core';
import { slotShots } from '../src/match/slot-shots';
import { videoItems, withVideoItems } from '../src/model/sequence';
import { DIMS, fakeEmbedder, makeProfile, normalise } from './fixtures/library';
import { buildTemplate } from './fixtures/template';
import { buildTimeline } from './fixtures/timeline';

const axis = (cosine: number) => {
  const out = new Float32Array(DIMS);
  out[0] = cosine;
  out[1] = Math.sqrt(1 - cosine * cosine);
  return normalise(out);
};

function world() {
  const template: Template = (() => {
    const built = buildTemplate({
      slots: [{ frames: 30, text: 'Someone checks a message' }, { frames: 30 }],
    });
    return {
      ...built,
      slots: built.slots.map((slot, index) =>
        index === 0
          ? {
              ...slot,
              intent: { ...slot.intent, needs: ['person looking at a phone'], face: 'hidden' as const },
            }
          : slot,
      ),
    };
  })();
  const base = buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }] }).timeline;
  const items = videoItems(base).map((item, index) =>
    item.type === 'clip' ? { ...item, slotId: template.slots[index]!.id } : item,
  );
  const timeline: Timeline = withVideoItems(base, items);
  const clips = videoItems(timeline).filter((item): item is Clip => item.type === 'clip');
  const profileOf = (clip: Clip, def: Parameters<typeof makeProfile>[0]): ShotProfile => ({
    ...makeProfile(def),
    assetId: clip.media.assetId,
    shotId: clip.media.kind === 'video' ? clip.media.shotId : null,
  });
  const walking = profileOf(clips[0]!, {
    embedding: axis(0.1),
    description: 'A man walks down a street',
    motionClass: 'tracking',
  });
  const other = profileOf(clips[1]!, {
    embedding: axis(0.2),
    description: 'A beach at dusk',
    motionClass: 'static',
  });
  const phone = makeProfile({ embedding: axis(0.7), description: 'Hands scroll a smartphone' });
  // The phone shot is an alternate of slot 1 in the cast.
  const cast = timeline.cast!;
  const withAlternate: Timeline = {
    ...timeline,
    cast: {
      ...cast,
      slots: cast.slots.map((slot, index) => ({
        ...slot,
        slotId: template.slots[index]!.id,
        alternates:
          index === 0 ? [{ ...slot.pick!, assetId: phone.assetId, shotId: phone.shotId }] : slot.alternates,
      })),
    },
  };
  const all = [walking, other, phone];
  const profiles = {
    profiles: async (refs: readonly { assetId: string; shotId: string | null }[]) =>
      ok(all.filter((profile) => refs.some((ref) => ref.shotId === profile.shotId))),
  };
  const needVector = new Float32Array(DIMS);
  needVector[0] = 1;
  return {
    template,
    timeline: withAlternate,
    clips,
    profiles,
    embedder: fakeEmbedder(new Map([['person looking at a phone', needVector]])),
  };
}

describe('slotShots', () => {
  it("gives each clip's measured move and whether it meets its slot's needs, with the alternates that do", async () => {
    const { template, timeline, clips, profiles, embedder } = world();
    const shots = await slotShots(timeline, template, { profiles, embedder });
    expect(shots.ok && shots.value).toEqual([
      {
        clipId: clips[0]!.id,
        slotId: template.slots[0]!.id,
        motion: 'tracking',
        needs: [{ text: 'person looking at a phone', met: false, by: null, others: 1 }],
      },
      { clipId: clips[1]!.id, slotId: template.slots[1]!.id, motion: 'static', needs: [] },
    ]);
  });

  it('reads needs by their words when there is no embedder', async () => {
    const { template, timeline, profiles } = world();
    const shots = await slotShots(timeline, template, { profiles });
    expect(shots.ok && shots.value[0]?.needs[0]).toMatchObject({ met: false, others: 0 });
  });
});
