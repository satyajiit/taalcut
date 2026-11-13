// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { newId, ok, SIMPLE_EDITOR_COMMANDS as N, unwrap, type Clip } from '@taalcut/core';
import { commandWorld } from '../fixtures/command-world';
import { transcriptOccurrences } from '../../src/edits/transcript-occurrences';
import { sourceFrames } from '../../src/model/speed';
import { at, fixture } from './fixtures';

it.each([N.adjustClips, N.copyClipSettings, N.removeWords])(
  '%s refuses the whole operation when one affected clip is locked',
  async (name) => {
    const data = fixture();
    const second = data.timeline.tracks[0]!.items.find(
      (item): item is Clip => item.type === 'clip' && item.id === data.ids[1],
    )!;
    second.locked = true;
    const world = commandWorld({ transcripts: async () => ok(data.transcript) });
    await world.seed(data.timeline);
    const available = transcriptOccurrences(
      data.timeline,
      new Map([
        [data.first.media.assetId, data.transcript],
        [second.media.assetId, data.transcript],
      ]),
    );
    const payload =
      name === N.adjustClips
        ? { clipIds: data.ids, color: { exposure: 1 } }
        : name === N.copyClipSettings
          ? { sourceClipId: data.ids[0], clipIds: data.ids, settings: ['color'] }
          : { words: available };
    const before = structuredClone(world.doc(data.timeline.id));
    expect((await world.dispatch(name, { ...data.target, ...payload })).ok).toBe(false);
    expect(world.doc(data.timeline.id)).toEqual(before);
    expect(await world.bus.history(data.timeline.projectId)).toEqual(ok({ undo: null, redo: null }));
  },
);

it('caption replacement validates all matches before committing and treats the replacement literally', async () => {
  const data = fixture(),
    world = commandWorld();
  await world.seed(data.timeline);
  const before = structuredClone(world.doc(data.timeline.id));
  const refused = await world.dispatch(N.replaceCaptions, {
    ...data.target,
    find: 'Hello',
    replacement: 'x'.repeat(101),
  });
  expect(refused.ok).toBe(false);
  expect(world.doc(data.timeline.id)).toEqual(before);
  unwrap(await world.dispatch(N.replaceCaptions, { ...data.target, find: 'Hello', replacement: '$&' }));
  expect(world.doc(data.timeline.id).captions!.cues.every((cue) => cue.words[0]!.text === '$&')).toBe(true);
  expect(world.doc(data.timeline.id).tracks).toEqual(before.tracks);
});

describe('transcript occurrences', () => {
  it('separates duplicate footage and integrates trimmed speed ramps through a second cut', async () => {
    const data = fixture();
    const first = data.first;
    first.speed = {
      curve: 'linear',
      points: [
        { at: at(0), speed: 0.5 },
        { at: at(90), speed: 2 },
      ],
    };
    const duplicate = { ...structuredClone(first), id: data.ids[1]! };
    data.timeline.tracks[0]!.items = [first, duplicate];
    const map = new Map([[first.media.assetId, data.transcript]]);
    const words = transcriptOccurrences(data.timeline, map);
    expect(words).toHaveLength(4);
    expect(words[2]!.range.start.value - words[0]!.range.start.value).toBe(90);
    const world = commandWorld({ transcripts: async () => ok(data.transcript) });
    await world.seed(data.timeline);
    unwrap(await world.dispatch(N.removeWords, { ...data.target, words: [words[0]!] }));
    const changed = world.doc(data.timeline.id);
    const remaining = transcriptOccurrences(changed, map);
    expect(remaining.filter((word) => word.clipId === duplicate.id)).toHaveLength(2);
    const trimmed = changed.tracks[0]!.items[0] as Clip;
    const removed = words[0]!.range.duration.value;
    expect(trimmed.speed!.windowStart!.value).toBe(removed);
    expect(sourceFrames(trimmed.speed, 8)).toBeCloseTo(
      sourceFrames(first.speed, removed + 8) - sourceFrames(first.speed, removed),
      8,
    );
  });
  it('rejects a stale word reference without changing footage', async () => {
    const data = fixture(),
      world = commandWorld({ transcripts: async () => ok(data.transcript) });
    await world.seed(data.timeline);
    const word = transcriptOccurrences(
      data.timeline,
      new Map([[data.first.media.assetId, data.transcript]]),
    )[0]!;
    expect(
      (
        await world.dispatch(N.removeWords, {
          ...data.target,
          words: [{ ...word, assetId: newId<'Asset'>() }],
        })
      ).ok,
    ).toBe(false);
    expect(world.doc(data.timeline.id).revision).toBe(1);
  });
});
