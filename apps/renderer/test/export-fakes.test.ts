// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The export area's fakes answer like the real handlers: Content Credentials (person only, undoable), the
// export options' credentials note, ducking, hits, the voiceover, reframing, pro export with its warnings and
// Save as…, and library.credits from the assets' provenance.
import { callRpc, timelineSchema, type Clip, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_PROJECT, GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';

const projectId = GOLDEN_PROJECT;
const timelineId = GOLDEN_TIMELINES[0]!;

function setup() {
  const { client, controls } = createFakeBackend({
    phase2: { library: { tickMs: 0 } },
    make: { renderTickMs: 0 },
  });
  const dispatch = (name: string, payload: unknown, source: 'ui' | 'agent' = 'ui') =>
    source === 'agent'
      ? controls.bus.dispatch(name, payload, { source, actor: 'agent:test' })
      : callRpc(client.commands.dispatch({ name, payload, source }));
  const undo = () => callRpc(client.commands.undo({ projectId, source: 'ui' }));
  const get = () => client.timelines.get({ timelineId });
  const options = () => client.renders.exportOptions({ projectId, timelineId });
  const showcase = () => expect(controls.make.p3.interchange.showcase(projectId, timelineId)).toBe(true);
  return { client, controls, dispatch, undo, get, options, showcase };
}

const valid = (timeline: Timeline) =>
  expect(timelineSchema.safeParse(timeline).error?.issues ?? []).toEqual([]);
const role = (timeline: Timeline, name: 'voice' | 'sfx') =>
  timeline.tracks.find((track) => track.kind === 'audio' && track.role === name);
const clipsOn = (timeline: Timeline, name: 'voice' | 'sfx') =>
  (role(timeline, name)?.items ?? []).filter((item): item is Clip => item.type === 'clip');

describe('export fakes: Content Credentials', () => {
  it('are off by default, a person turns them on, the agent is refused, and ⌘Z turns them off', async () => {
    const { dispatch, undo, options } = setup();
    expect((await options()).credentials).toEqual({ add: false, sourcesWithCredentials: 0, disclosures: [] });
    const agent = await dispatch('render.setContentCredentials', { projectId, add: true }, 'agent');
    expect(agent.ok ? null : agent.error.code).toBe('core.command_source_refused');
    expect((await dispatch('render.setContentCredentials', { projectId, add: true })).ok).toBe(true);
    expect((await options()).credentials?.add).toBe(true);
    expect((await undo()).ok).toBe(true);
    expect((await options()).credentials?.add).toBe(false);
  });

  it('remind about every platform once a model made a part, and count the signed originals', async () => {
    const { options, showcase } = setup();
    showcase();
    expect((await options()).credentials).toEqual({
      add: false,
      sourcesWithCredentials: 1,
      disclosures: ['shorts', 'reels', 'tiktok'],
    });
  });
});

describe('export fakes: the mix and the voice', () => {
  it('ducking: a change is one undo step, the same value is no step', async () => {
    const { dispatch, undo, get } = setup();
    const before = await get();
    expect(
      (await dispatch('music.setDucking', { projectId, timelineId, ducking: { enabled: false } })).ok,
    ).toBe(true);
    const after = await get();
    expect(after.mix.ducking.enabled).toBe(false);
    expect(after.revision).toBe(before.revision + 1);
    expect(
      (await dispatch('music.setDucking', { projectId, timelineId, ducking: { enabled: false } })).ok,
    ).toBe(true);
    expect((await get()).revision).toBe(after.revision);
    expect((await dispatch('music.setDucking', { projectId, timelineId, ducking: {} })).ok).toBe(false);
    expect((await undo()).ok).toBe(true);
    expect((await get()).mix.ducking).toEqual(before.mix.ducking);
  });

  it('hits: placed on the frame at or after the cut, overlaps refused, none removes the track, ⌘Z puts it back', async () => {
    const { dispatch, undo, get, showcase } = setup();
    showcase();
    const before = await get();
    expect(clipsOn(before, 'sfx')).toHaveLength(3);
    expect((await dispatch('sfx.setHits', { projectId, timelineId, hits: [] })).ok).toBe(true);
    expect(role(await get(), 'sfx')).toBeUndefined();
    expect((await undo()).ok).toBe(true);
    expect(clipsOn(await get(), 'sfx')).toHaveLength(3);
    const hit = (frame: number) => ({
      id: '01K7HXT0000000000000000000',
      at: { value: frame * 1000 + 500, rate: { num: 30000, den: 1 } },
      assetId: clipsOn(before, 'sfx')[0]!.media.assetId,
      sourceStart: { value: 0, rate: { num: 48000, den: 1 } },
      duration: { value: 24000, rate: { num: 48000, den: 1 } },
      gainDb: -6,
      category: 'whoosh',
    });
    const overlap = await dispatch('sfx.setHits', {
      projectId,
      timelineId,
      hits: [hit(10), { ...hit(12), id: '01K7HXT0000000000000000001' }],
    });
    expect(overlap.ok ? null : overlap.error.code).toBe('core.validation');
    expect((await dispatch('sfx.setHits', { projectId, timelineId, hits: [hit(10)] })).ok).toBe(true);
    const placed = clipsOn(await get(), 'sfx');
    expect(placed).toHaveLength(1);
    valid(await get());
  });

  it('the voiceover comes out with its track, and ⌘Z puts both back', async () => {
    const { dispatch, undo, get, showcase } = setup();
    showcase();
    const before = await get();
    expect(before.voiceover?.voiceName).toBe('Meera');
    valid(before);
    expect((await dispatch('voice.removeVoiceover', { projectId, timelineId, revision: 1 })).ok).toBe(false);
    expect((await dispatch('voice.removeVoiceover', { projectId, timelineId })).ok).toBe(true);
    const after = await get();
    expect(after.voiceover).toBeNull();
    expect(role(after, 'voice')).toBeUndefined();
    expect((await undo()).ok).toBe(true);
    expect((await get()).voiceover).toEqual(before.voiceover);
    expect(clipsOn(await get(), 'voice')).toHaveLength(2);
  });

  it('reframe: a video clip only, a stale revision is a conflict, ⌘Z restores it', async () => {
    const { dispatch, undo, get, showcase } = setup();
    showcase();
    const before = await get();
    const clip = before.tracks[0]!.items.filter((item): item is Clip => item.type === 'clip')[0]!;
    const reframe = { mode: 'centre', nudge: { x: 0, y: 0 }, scale: 1 };
    const stale = await dispatch('timeline.setReframe', {
      projectId,
      timelineId,
      revision: 1,
      clipId: clip.id,
      reframe,
    });
    expect(stale.ok ? null : stale.error.code).toBe('core.conflict');
    expect(
      (await dispatch('timeline.setReframe', { projectId, timelineId, clipId: clip.id, reframe })).ok,
    ).toBe(true);
    const framed = (await get()).tracks[0]!.items.find((item) => item.id === clip.id);
    expect(framed?.type === 'clip' ? framed.reframe?.mode : null).toBe('centre');
    expect((await undo()).ok).toBe(true);
    const back = (await get()).tracks[0]!.items.find((item) => item.id === clip.id);
    expect(back?.type === 'clip' ? back.reframe?.mode : null).toBe('auto');
  });
});

describe('export fakes: pro export and credits', () => {
  it('lists both writers, writes a file with its warnings, never overwrites, and Save as… copies it', async () => {
    const { client, dispatch, get } = setup();
    expect(
      (await client.timelines.interchangeFormats()).map((format) => [format.id, format.version]),
    ).toEqual([
      ['otio', '0.18.1'],
      ['fcpxml', '1.14'],
    ]);
    const revision = (await get()).revision;
    const first = await dispatch('timeline.exportInterchange', {
      projectId,
      timelineId,
      format: 'otio',
      revision,
    });
    const second = await dispatch('timeline.exportInterchange', { projectId, timelineId, format: 'otio' });
    const file = (result: typeof first) =>
      result.ok
        ? (result.value as { result: { fileName: string; warnings: { code: string }[] } }).result
        : null;
    expect(file(first)?.fileName).toBe('Golden hour market – Golden hour market · 1.otio');
    expect(file(second)?.fileName).toBe('Golden hour market – Golden hour market · 1 2.otio');
    expect(file(first)?.warnings.map((warning) => warning.code)).toContain('textAsMarker');
    const stale = await dispatch('timeline.exportInterchange', {
      projectId,
      timelineId,
      format: 'fcpxml',
      revision: 1,
    });
    expect(stale.ok ? null : stale.error.code).toBe('core.conflict');
    expect(await client.files.saveExportAs({ fileName: file(first)!.fileName })).toEqual({
      saved: true,
      fileName: 'Golden hour market – Golden hour market · 1.otio',
    });
    await expect(client.files.saveExportAs({ fileName: 'Not written.otio' })).rejects.toThrow();
  });

  it('credits: a CC BY line is required, Pexels is courtesy, captured footage asks nothing', async () => {
    const { client, get, showcase } = setup();
    const plain = await get();
    const assets = (timeline: Timeline) => [
      ...new Set(
        timeline.tracks.flatMap((track) =>
          track.kind === 'text'
            ? []
            : track.items.flatMap((item) => (item.type === 'clip' ? [item.media.assetId] : [])),
        ),
      ),
    ];
    expect(await client.library.credits({ assetIds: assets(plain) })).toEqual({ required: [], courtesy: [] });
    showcase();
    expect(await client.library.credits({ assetIds: assets(await get()) })).toEqual({
      required: ['"Whoosh short" by kinoton (https://freesound.org/s/612091/) licensed under CC BY 4.0'],
      courtesy: ['Video by Ana Lima on Pexels'],
    });
  });
});
