// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { callRpc, timelineSchema, type Clip, type Timeline } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_PROJECT, GOLDEN_RENDER, GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';

const projectId = GOLDEN_PROJECT;
const timelineId = GOLDEN_TIMELINES[0]!;
const beat = (frames: number) => ({ value: frames, rate: { num: 30, den: 1 } });

function setup(renderTickMs = 0) {
  const { client, controls } = createFakeBackend({
    phase2: { library: { tickMs: 0 } },
    make: { renderTickMs },
  });
  // The page may dispatch only as 'ui'; the agent's edits go straight onto the bus, as the agent process's do.
  const dispatch = (name: string, payload: unknown, source: 'ui' | 'agent' = 'ui') =>
    source === 'agent'
      ? controls.bus.dispatch(name, payload, { source, actor: 'agent:test' })
      : callRpc(client.commands.dispatch({ name, payload, source }));
  const undo = () => callRpc(client.commands.undo({ projectId, source: 'ui' }));
  const redo = () => callRpc(client.commands.redo({ projectId, source: 'ui' }));
  const get = () => client.timelines.get({ timelineId });
  return { client, controls, dispatch, undo, redo, get };
}

const clips = (timeline: Timeline) =>
  timeline.tracks[0]!.items.filter((item): item is Clip => item.type === 'clip');
const lengths = (timeline: Timeline) => clips(timeline).map((clip) => clip.duration.value);
const valid = (timeline: Timeline) =>
  expect(timelineSchema.safeParse(timeline).error?.issues ?? []).toEqual([]);

describe('Make fakes: timeline commands', () => {
  it('a trim between two clips rolls the cut on the beat; ⌘Z puts it back, redo again', async () => {
    const { dispatch, undo, redo, get } = setup();
    const before = await get();
    const third = clips(before)[2]!;
    const result = await dispatch('timeline.trimClip', {
      projectId,
      timelineId,
      clipId: third.id,
      edge: 'end',
      by: beat(-15),
    });
    expect(result.ok).toBe(true);
    const after = await get();
    valid(after);
    expect(after.revision).toBe(before.revision + 1);
    expect(lengths(after)[2]).toBe(lengths(before)[2]! - 15);
    expect(lengths(after)[3]).toBe(lengths(before)[3]! + 15);
    expect(lengths(after).reduce((a, b) => a + b)).toBe(lengths(before).reduce((a, b) => a + b));
    expect(clips(after)[2]!.id).toBe(third.id);
    expect((await undo()).ok).toBe(true);
    expect(lengths(await get())).toEqual(lengths(before));
    expect((await redo()).ok).toBe(true);
    expect(lengths(await get())).toEqual(lengths(after));
  });

  it('the last edge ripples and the first slips', async () => {
    const { dispatch, get } = setup();
    const before = await get();
    const last = clips(before).at(-1)!;
    await dispatch('timeline.trimClip', {
      projectId,
      timelineId,
      clipId: last.id,
      edge: 'end',
      by: beat(-15),
    });
    const rippled = await get();
    valid(rippled);
    expect(lengths(rippled).reduce((a, b) => a + b)).toBe(lengths(before).reduce((a, b) => a + b) - 15);
    const first = clips(before)[0]!;
    await dispatch('timeline.trimClip', {
      projectId,
      timelineId,
      clipId: first.id,
      edge: 'start',
      by: beat(5),
    });
    const slipped = await get();
    valid(slipped);
    expect(lengths(slipped)[0]).toBe(lengths(before)[0]);
    expect(clips(slipped)[0]!.sourceStart.value).not.toBe(first.sourceStart.value);
  });

  it('a move keeps every position’s length and the clip’s id', async () => {
    const { dispatch, undo, get } = setup();
    const before = await get();
    const moved = clips(before)[1]!;
    expect(
      (await dispatch('timeline.moveClip', { projectId, timelineId, clipId: moved.id, toIndex: 4 })).ok,
    ).toBe(true);
    const after = await get();
    valid(after);
    expect(lengths(after)).toEqual(lengths(before));
    expect(clips(after)[4]!.id).toBe(moved.id);
    expect(after.cast!.slots[4]!.clipId).toBe(moved.id);
    await undo();
    expect(clips(await get()).map((clip) => clip.id)).toEqual(clips(before).map((clip) => clip.id));
  });

  it('a swap from an alternate keeps the clip, marks the slot yours and moves the old pick to the alternates', async () => {
    const { dispatch, get } = setup();
    const before = await get();
    const slot = before.cast!.slots[6]!;
    const alternate = slot.alternates[1]!;
    const result = await dispatch('timeline.swapClip', {
      projectId,
      timelineId,
      clipId: slot.clipId,
      media: { assetId: alternate.assetId, shotId: alternate.shotId },
      from: 'alternate',
    });
    expect(result.ok).toBe(true);
    const after = await get();
    valid(after);
    const now = after.cast!.slots[6]!;
    expect(now.pick?.shotId).toBe(alternate.shotId);
    expect(now.note).toBe('userPick');
    expect(now.alternates[0]?.shotId).toBe(slot.pick?.shotId);
    expect(clips(after)[6]!.id).toBe(slot.clipId);
  });

  it('text edits, locks and agent edits of a locked clip', async () => {
    const { dispatch, get } = setup();
    const before = await get();
    const text = before.tracks[1]!.items[0]!;
    await dispatch('timeline.editText', { projectId, timelineId, itemId: text.id, text: 'GOA, 15 SECONDS' });
    const edited = (await get()).tracks[1]!.items[0]!;
    expect(edited.type === 'text' && [edited.text, edited.origin]).toEqual(['GOA, 15 SECONDS', 'user']);
    const clip = clips(before)[2]!;
    await dispatch('timeline.lockClip', { projectId, timelineId, clipId: clip.id, locked: true });
    const refused = await dispatch(
      'timeline.trimClip',
      { projectId, timelineId, clipId: clip.id, edge: 'end', by: beat(-15) },
      'agent',
    );
    expect(!refused.ok && refused.error.code).toBe('timeline.clip_locked');
  });

  it('watch yields the document, then every new revision', async () => {
    const { client, dispatch } = setup();
    const controller = new AbortController();
    const stream = await client.timelines.watch({ timelineId }, { signal: controller.signal });
    const first = await stream.next();
    expect((first.value as Timeline).revision).toBe(7);
    const clip = clips(first.value as Timeline)[0]!;
    await dispatch('timeline.lockClip', { projectId, timelineId, clipId: clip.id, locked: true });
    const second = await stream.next();
    expect((second.value as Timeline).revision).toBe(8);
    controller.abort();
  });
});

describe('Make fakes: projects, versions and renders', () => {
  it('lists projects newest first with posters, and restoring a version is undoable', async () => {
    const { client, dispatch, undo, get } = setup();
    const list = await client.projects.list({});
    expect(list.items.map((project) => project.name)).toContain('Golden hour market');
    expect(list.items.every((project) => project.archivedAt === null)).toBe(true);
    const versions = await client.projects.versions({ timelineId });
    const first = versions.items.at(-1)!;
    expect(first.kind).toBe('auto');
    const swapped = await get();
    expect(
      (await dispatch('project.restoreVersion', { projectId, timelineId, versionId: first.id })).ok,
    ).toBe(true);
    const restored = await get();
    expect(restored.cast!.slots[3]!.note).not.toBe('userPick');
    const after = await client.projects.versions({ timelineId });
    expect(after.items[0]!.kind).toBe('before-restore');
    await undo();
    expect((await get()).cast!.slots[3]!.pick?.shotId).toBe(swapped.cast!.slots[3]!.pick?.shotId);
  });

  it('has renders in each state, and an export runs through to ready with its QA', async () => {
    const { client, controls, dispatch } = setup();
    const renders = await client.renders.list({});
    expect(new Set(renders.map((render) => render.status))).toEqual(
      new Set(['ready', 'rendering', 'queued', 'needsAttention', 'failed', 'cancelled']),
    );
    const report = await client.renders.qaReport({ renderId: GOLDEN_RENDER });
    expect(report.checks.filter((check) => check.status === 'warn')).toHaveLength(1);
    const exported = await dispatch('render.export', {
      projectId,
      timelineId: GOLDEN_TIMELINES[1],
      presetId: 'reels',
      captions: { burnIn: true, sidecars: [] },
    });
    expect(exported.ok).toBe(true);
    const id = (exported.ok && (exported.value as { result: { renderId: string } }).result.renderId) as never;
    expect((await client.renders.get({ renderId: id })).status).toBe('queued');
    expect(controls.make.renders.list().some((render) => render.id === id)).toBe(true);
  });

  it('export does what the real engine does now: landscape and standard queue', async () => {
    const { dispatch } = setup(1);
    const request = { projectId, timelineId, captions: { burnIn: true, sidecars: [] } };
    for (const presetId of ['landscape', 'standard'] as const) {
      const queued = await dispatch('render.export', { ...request, presetId });
      expect(queued.ok, presetId).toBe(true);
    }
  });

  it('generated music whose warped file the media cache lacks stops at preflight (M6)', async () => {
    const { client, dispatch } = setup(1);
    const request = { projectId, timelineId, captions: { burnIn: true, sidecars: [] } };
    // A warp nothing made: no music.generate wrote this file, and nothing warps it again.
    const choice = {
      path: 'generated',
      assetId: '01JA0000000000000000000000',
      warpedKey: `warped/ab/${'ab'.repeat(32)}.v1.flac`,
      bpm: 120,
      grid: { maxErrorMs: 12, p95ErrorMs: 6, missed: 0 },
      gainDb: -3,
    };
    expect((await dispatch('music.choosePath', { projectId, timelineId, choice })).ok).toBe(true);
    const exported = await dispatch('render.export', { ...request, presetId: 'reels' });
    const id = (exported.ok && (exported.value as { result: { renderId: string } }).result.renderId) as never;
    await vi.waitFor(async () => expect((await client.renders.get({ renderId: id })).status).toBe('failed'), {
      timeout: 15_000,
    });
    const failed = await client.renders.get({ renderId: id });
    expect(failed.error).toMatchObject({ code: 'render.media_missing', params: { name: 'generated music' } });
    expect(failed.bytes).toBeNull();
  });

  it('generated music whose warped file music.generate left in the cache exports (M6)', async () => {
    const { client, controls, dispatch } = setup(1);
    // The showcase's timeline: music.generate's choice, its warped file in the media cache.
    expect(controls.make.p3.interchange.showcase(projectId, timelineId)).toBe(true);
    const music = (await client.timelines.get({ timelineId })).music;
    expect(music.path).toBe('generated');
    const request = { projectId, timelineId, captions: { burnIn: true, sidecars: [] } };
    const exported = await dispatch('render.export', { ...request, presetId: 'reels' });
    const id = (exported.ok && (exported.value as { result: { renderId: string } }).result.renderId) as never;
    await vi.waitFor(
      async () =>
        expect(['ready', 'needsAttention']).toContain((await client.renders.get({ renderId: id })).status),
      { timeout: 15_000 },
    );
    expect((await client.renders.get({ renderId: id })).error).toBeNull();
  });

  it('setExportPreset saves a built landscape preset with the bumpers choice, and undo restores it (finding 13)', async () => {
    const { client, dispatch, undo } = setup(1);
    const set = await dispatch('render.setExportPreset', {
      projectId,
      presetId: 'landscape',
      captions: { burnIn: true, sidecars: [] },
      includeBumpers: false,
    });
    expect(set.ok).toBe(true);
    expect((await client.renders.exportOptions({ projectId, timelineId })).defaultPresetId).toBe('landscape');
    expect((await undo()).ok).toBe(true);
    expect((await client.renders.exportOptions({ projectId, timelineId })).defaultPresetId).not.toBe(
      'landscape',
    );
  });

  it('Notify me is undoable; Export anyway is a person’s alone; delete comes back with ⌘Z', async () => {
    const { client, dispatch, undo } = setup();
    const renders = await client.renders.list({});
    const attention = renders.find((render) => render.status === 'needsAttention')!;
    const asAgent = await dispatch(
      'render.overrideQa',
      { projectId: attention.projectId, renderId: attention.id, checks: ['captionSafeZone'] },
      'agent',
    );
    expect(!asAgent.ok && asAgent.error.code).toBe('core.command_source_refused');
    const override = await dispatch('render.overrideQa', {
      projectId: attention.projectId,
      renderId: attention.id,
      checks: ['captionSafeZone'],
    });
    expect(override.ok).toBe(true);
    expect((await client.renders.get({ renderId: attention.id })).qa?.verdict).toBe('overridden');
    await dispatch('render.setNotify', { projectId, renderId: GOLDEN_RENDER, notify: true });
    expect((await client.renders.get({ renderId: GOLDEN_RENDER })).notify).toBe(true);
    await undo();
    expect((await client.renders.get({ renderId: GOLDEN_RENDER })).notify).toBe(false);
    await dispatch('render.delete', { projectId, renderId: GOLDEN_RENDER });
    expect((await client.renders.list({})).some((render) => render.id === GOLDEN_RENDER)).toBe(false);
    await undo();
    expect((await client.renders.list({})).some((render) => render.id === GOLDEN_RENDER)).toBe(true);
  });

  it('export options say what fits, and the reel’s music is the video’s own, with nothing to acknowledge (REF1)', async () => {
    const { client, dispatch } = setup();
    const options = await client.renders.exportOptions({ projectId, timelineId });
    // Every preset fits; the Mac has no AV1 encoder, so the AV1 ones say so (LNX1-AV1).
    expect(options.presets.filter((entry) => !entry.available).map((entry) => entry.reasonKey)).toEqual([
      'render.unavailable.noAv1Encoder',
      'render.unavailable.noAv1Encoder',
    ]);
    // Golden hour keeps its reel: the video plays its music, and the steps carry its link and sound.
    const template = (await client.timelines.get({ timelineId })).template!;
    expect(options.music.referenceAudioAvailable).toBe(true);
    expect(options.music.current).toEqual({ path: 'referenceAudio', templateId: template.id, gainDb: 0 });
    expect(options.music.platformSound?.referenceUrl).toMatch(/^https:\/\/www\.instagram\.com\/reel\//);
    expect(options.music.platformSound?.soundLabel).toBe('Golden Hour (sped up) · JVKE');
    // Off and on again, from a person or the agent, with no acknowledgement.
    expect(
      (await dispatch('music.choosePath', { projectId, timelineId, choice: { path: 'platformSound' } })).ok,
    ).toBe(true);
    const choice = { path: 'referenceAudio', templateId: template.id, gainDb: 0 };
    expect((await dispatch('music.choosePath', { projectId, timelineId, choice }, 'agent')).ok).toBe(true);
    expect((await client.renders.exportOptions({ projectId, timelineId })).music.current.path).toBe(
      'referenceAudio',
    );
  });
});
