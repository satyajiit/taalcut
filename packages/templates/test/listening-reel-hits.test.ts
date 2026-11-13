// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-C2: a template's effects on its cuts (sfxAtCuts) follow onto a video made from it, at the same cuts. The
 * templates are F2's fixture films (tools/earshot-parity), their listening from upstream earshot's own sync.
 */
import { describe, expect, it } from 'vitest';
import { RationalTime, type SequenceItem, type Template, type Timeline } from '@taalcut/core';
import { reelHitRequests, reelSoundFor, timelineCutMs } from '../src/index';
import { film, filmTemplate, madeTimeline } from './helpers/listening-film';

const FILMS = ['film-00', 'film-01', 'film-03', 'film-08'];

/** A video like `timeline` with two shots of slot `index` (one cut more). */
function withSplit(timeline: Timeline, index: number): Timeline {
  const video = timeline.tracks[0]!;
  if (video.kind !== 'video') throw new Error('no V1');
  const items: SequenceItem[] = video.items.flatMap((item, i) => {
    if (i !== index || item.type !== 'clip') return [item];
    const half = Math.floor(item.duration.value / 2);
    const rate = item.duration.rate;
    return [
      { ...item, duration: RationalTime.of(half, rate) },
      {
        ...item,
        id: `${item.id.slice(0, -1)}Z` as typeof item.id,
        duration: RationalTime.of(item.duration.value - half, rate),
      },
    ];
  });
  return { ...timeline, tracks: [{ ...video, items }] };
}

describe('reelHitRequests (EAR1-C2)', () => {
  it.each(FILMS)('puts %s’s effects on the same cuts of a video made from it', (id) => {
    const template: Template = filmTemplate(film(id));
    const timeline = madeTimeline(template);
    const effects = template.audio.listening!.sfxAtCuts;
    expect(effects.length).toBeGreaterThan(10);
    const requests = reelHitRequests(template, timeline)!;
    const cuts = timelineCutMs(timeline);
    const same = effects.filter((effect) =>
      requests.some(
        (request) =>
          request.cutIndex === effect.cutIndex - 1 &&
          request.family === effect.family &&
          request.offsetMs === effect.offsetMs,
      ),
    );
    expect(same.length / effects.length).toBeGreaterThanOrEqual(0.9);
    for (const request of requests) {
      const slot = template.slots[request.slotIndex]!;
      expect(request.cutMs).toBeCloseTo(cuts[request.cutIndex]!, 6);
      expect(request.cutMs).toBeCloseTo(RationalTime.toSeconds(slot.start) * 1000, 6);
    }
  });

  it('keeps each effect on its cut when the template’s slots changed since, and drops one whose cut went', () => {
    const template = filmTemplate(film('film-00'));
    const listening = template.audio.listening!;
    // Slots 4 and 5 merged after the breakdown: every effect from slot 5 on is one slot earlier now.
    const merged: Template = {
      ...template,
      slots: template.slots
        .filter((_, index) => index !== 5)
        .map((slot, index) =>
          index === 4
            ? { ...slot, duration: RationalTime.add(slot.duration, template.slots[5]!.duration) }
            : slot,
        ),
    };
    const requests = reelHitRequests(merged, madeTimeline(merged))!;
    const expected = listening.sfxAtCuts
      .filter((effect) => effect.cutIndex !== 5)
      .map((effect) => (effect.cutIndex > 5 ? effect.cutIndex - 1 : effect.cutIndex));
    expect(requests.map((request) => request.slotIndex)).toEqual(expected);
  });

  it('gives none to a video with other cuts, or a template that heard nothing', () => {
    const template = filmTemplate(film('film-01'));
    expect(reelHitRequests(template, withSplit(madeTimeline(template), 3))).toBeNull();
    const deaf: Template = { ...template, audio: { ...template.audio, listening: null } };
    expect(reelHitRequests(deaf, madeTimeline(deaf))).toBeNull();
  });
});

describe('reelSoundFor', () => {
  const bank = [
    { id: 'whoosh_fast/air', family: 'whoosh' as const, title: 'Fast air whoosh', kinds: ['whoosh.short'] },
    { id: 'whoosh_swish/soft', family: 'whoosh' as const, title: 'Soft swish', kinds: ['whoosh'] },
    { id: 'cut_hit/sub', family: 'impact' as const, title: 'Sub boom', kinds: ['impact', 'boom'] },
  ];

  it('picks the family’s sound that shares most words with what the reel had, the first without any', () => {
    expect(reelSoundFor(bank, 'whoosh', 'a soft swish')?.id).toBe('whoosh_swish/soft');
    expect(reelSoundFor(bank, 'whoosh', 'a fast air whoosh')?.id).toBe('whoosh_fast/air');
    expect(reelSoundFor(bank, 'whoosh', undefined)?.id).toBe('whoosh_fast/air');
    expect(reelSoundFor(bank, 'impact', 'a deep cinematic boom')?.id).toBe('cut_hit/sub');
    expect(reelSoundFor(bank, 'riser', 'an uplifter sweep')).toBeNull();
  });
});
