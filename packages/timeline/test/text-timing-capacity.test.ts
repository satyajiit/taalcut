// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { FrameRates, newId, RationalTime, type Timeline, type Track } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { editText } from '../src/edits/text';
import { checkEdited } from '../src/model/validate';
import { buildTimeline } from './fixtures/timeline';

const f = (value: number) => RationalTime.of(value, FrameRates.fps30);
const user = { source: 'ui' } as const;

function crowded(textTracks: number, audioTracks: number) {
  const { timeline } = buildTimeline({
    clips: [{ frames: 90 }],
    texts: [
      { start: 0, frames: 10 },
      { start: 15, frames: 10 },
      { start: 30, frames: 10 },
    ],
  });
  const track = timeline.tracks[1];
  if (track?.kind !== 'text') throw new Error('Expected text fixture');
  const blocker = track.items[2]!;
  const tracks: Track[] = [
    ...timeline.tracks,
    ...Array.from({ length: textTracks - 1 }, (_, index) => ({
      ...track,
      id: `T${index + 2}`,
      items: [{ ...blocker, id: newId<'TimelineItem'>() }],
    })),
    ...Array.from({ length: audioTracks }, (_, index) => ({
      kind: 'audio' as const,
      role: 'clip' as const,
      id: `A${index + 1}`,
      name: '',
      enabled: true,
      items: [],
    })),
  ];
  const full: Timeline = { ...timeline, tracks };
  const checked = checkEdited(full);
  if (!checked.ok) throw new Error(checked.error.detail);
  return { timeline: full, first: track.items[0]!.id, second: track.items[1]!.id };
}

describe.each([
  { limit: 'all nine text track ids', textTracks: 9, audioTracks: 0 },
  { limit: 'sixteen total tracks', textTracks: 6, audioTracks: 9 },
])('text retiming at $limit', ({ textTracks, audioTracks }) => {
  it('refuses the whole batch when one item cannot be placed, preserving every original item', () => {
    const { timeline, first, second } = crowded(textTracks, audioTracks);
    const before = structuredClone(timeline);
    const result = editText(
      timeline,
      {
        edits: [
          { itemId: first, start: f(45) },
          { itemId: second, start: f(30) },
        ],
      },
      user,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'timeline.invalid_move' } });
    expect(timeline).toEqual(before);
  });

  it('still permits a retime into an existing track with space', () => {
    const { timeline, first } = crowded(textTracks, audioTracks);
    const result = editText(timeline, { itemId: first, start: f(45) }, user);
    if (!result.ok) throw new Error(result.error.code);
    expect(checkEdited(result.value.timeline).ok).toBe(true);
    expect(result.value.timeline.tracks).toHaveLength(timeline.tracks.length);
    const text = result.value.timeline.tracks.flatMap((track) => (track.kind === 'text' ? track.items : []));
    expect(text.find((item) => item.id === first)?.start).toEqual(f(45));
    expect(text).toHaveLength(textTracks + 2);
  });
});
