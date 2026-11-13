// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  newId,
  RationalTime,
  TimeRange,
  unwrap,
  VOICE_COMMANDS,
  type Clip,
  type Voiceover,
} from '@taalcut/core';
import { expect, it } from 'vitest';
import { buildRoleTrack, trackOfRole } from '../../src/commands/audio-track';
import { createVoiceCommands } from '../../src/voice/voice-commands';
import { busWith, memoryTimelineStore, UI } from '../helpers/bus';
import { makeTestTimeline } from '../helpers/timeline';

function setup() {
  const timeline = makeTestTimeline({ clips: [{ frames: 300 }] });
  const at = (n: number) => RationalTime.of(n, timeline.canvas.rate);
  const sound = (startFrame: number) => ({
    id: newId<'TimelineItem'>(),
    startFrame,
    durationFrames: 30,
    assetId: newId<'Asset'>(),
    available: TimeRange.of(at(0), at(30)),
    sourceStart: at(0),
    gainDb: -3,
    slotId: null,
    beatAnchor: null,
  });
  const generated = sound(0),
    recorded = sound(90);
  const track = unwrap(buildRoleTrack(timeline, 'voice', [generated, recorded]));
  const take = track.items.find((item): item is Clip => item.id === recorded.id && item.type === 'clip')!;
  take.locked = true;
  const voiceover: Voiceover = {
    id: newId<'Voiceover'>(),
    voiceId: 'test',
    voiceName: 'Test',
    own: false,
    language: 'en',
    seed: 1,
    lines: [
      {
        id: newId<'VoiceLine'>(),
        text: 'Hello',
        slotId: null,
        clipId: generated.id,
        assetId: generated.assetId,
        quality: 'draft',
        duration: at(30),
        offBeat: false,
      },
    ],
  };
  timeline.tracks.push(track);
  timeline.voiceover = voiceover;
  const store = memoryTimelineStore(timeline);
  const { bus } = busWith(store, (deps) => createVoiceCommands(deps).all);
  const payload = {
    projectId: timeline.projectId,
    timelineId: timeline.id,
    revision: timeline.revision,
    voiceover,
    track: structuredClone(unwrap(buildRoleTrack(timeline, 'voice', [generated]))),
  };
  return { timeline, at, take, store, bus, payload };
}

it('keeps recorded takes and their settings through TTS replacement, undo, redo and removal', async () => {
  const { timeline, at, take, store, bus, payload } = setup();
  expect((await bus.dispatch(VOICE_COMMANDS.applyVoiceover, payload, UI)).ok).toBe(true);
  const assertKept = () => {
    const items = trackOfRole(store.current(timeline.id), 'voice')!.items;
    expect(items.find((item) => item.id === take.id)).toEqual(take);
    const before = items.slice(
      0,
      items.findIndex((item) => item.id === take.id),
    );
    expect(
      before.reduce((sum, item) => sum + (item.type === 'transition' ? 0 : item.duration.value), 0),
    ).toBe(90);
  };
  assertKept();
  expect((await bus.undo(timeline.projectId, UI)).ok).toBe(true);
  expect((await bus.redo(timeline.projectId, UI)).ok).toBe(true);
  assertKept();
  expect(
    (
      await bus.dispatch(
        VOICE_COMMANDS.removeVoiceover,
        { ...payload, revision: store.current(timeline.id).revision },
        UI,
      )
    ).ok,
  ).toBe(true);
  assertKept();
  const items = trackOfRole(store.current(timeline.id), 'voice')!.items;
  expect(items.filter((item) => item.type === 'clip')).toEqual([take]);
  expect(items[0]).toMatchObject({ type: 'gap', duration: at(90) });
});

it('rejects overlapping replacement speech atomically and retains the human recording', async () => {
  const { timeline, at, store, bus, payload } = setup();
  const before = structuredClone(store.current(timeline.id));
  const generated = payload.track.items.find((item) => item.type === 'clip')!;
  generated.duration = at(120);
  if (generated.media.kind !== 'image') generated.media.available = TimeRange.of(at(0), at(120));
  const done = await bus.dispatch(VOICE_COMMANDS.applyVoiceover, payload, UI);
  expect(done).toMatchObject({ ok: false, error: { code: 'core.validation' } });
  expect(store.current(timeline.id)).toEqual(before);
});

it('retains the join between recorded takes when generated speech is replaced or removed', async () => {
  const { timeline, at, take, store, bus, payload } = setup();
  if (take.media.kind === 'image') throw new Error('Expected recorded audio');
  take.media.available = TimeRange.of(at(0), at(90));
  take.sourceStart = at(30);
  const second = { ...structuredClone(take), id: newId<'TimelineItem'>() };
  const transition = {
    type: 'transition' as const,
    id: newId<'TimelineItem'>(),
    kind: 'dissolve' as const,
    inOffset: at(4),
    outOffset: at(5),
    direction: null,
  };
  trackOfRole(timeline, 'voice')!.items.push(transition, second);
  const assertRecordedJoin = () => {
    const items = trackOfRole(store.current(timeline.id), 'voice')!.items;
    const index = items.findIndex((item) => item.id === transition.id);
    expect(index).toBeGreaterThan(0);
    expect(items.slice(index - 1, index + 2)).toEqual([take, transition, second]);
    expect(items.filter((item) => item.type === 'transition')).toHaveLength(1);
    const start = items
      .slice(0, index - 1)
      .reduce((sum, item) => sum + (item.type === 'transition' ? 0 : item.duration.value), 0);
    expect(start).toBe(90);
  };
  unwrap(await bus.dispatch(VOICE_COMMANDS.applyVoiceover, payload, UI));
  assertRecordedJoin();
  unwrap(
    await bus.dispatch(
      VOICE_COMMANDS.removeVoiceover,
      { ...payload, revision: store.current(timeline.id).revision },
      UI,
    ),
  );
  assertRecordedJoin();
  expect(
    trackOfRole(store.current(timeline.id), 'voice')!.items.filter((item) => item.type === 'clip'),
  ).toEqual([take, second]);
  unwrap(await bus.undo(timeline.projectId, UI));
  assertRecordedJoin();
  unwrap(await bus.redo(timeline.projectId, UI));
  assertRecordedJoin();
});
