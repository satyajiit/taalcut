// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-MEM, "what worked": a finished export's facts come from its render, timeline, template and Style; the
 * recorder keeps one learned item per template and Style, refreshed and counted on each export, never twice for
 * one render; catch-up records what finished while the agent wasn't listening, after a watermark, so a deleted
 * item stays deleted.
 */
import {
  createMemorySettingsStore,
  DEFAULT_MIX,
  err,
  FrameRates,
  MEMORY_COMMANDS,
  newId,
  NotFoundError,
  ok,
  RationalTime,
  TIMELINE_SCHEMA_VERSION,
  TimeRange,
  unwrap,
  type MemoryItemView,
  type RenderId,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createWhatWorkedRecorder,
  renderFacts,
  WHAT_WORKED_SEEN_SETTING,
  whatWorkedText,
  type RenderFacts,
  type RenderFactsDeps,
  type RenderFactsRecord,
  type WhatWorkedDeps,
} from '../../src/memory';
import { memoryView } from './memory-support';

const fps30 = FrameRates.fps30;
const at = (frames: number) => RationalTime.of(frames, fps30);
const templateId = newId<'Template'>();
const styleId = newId<'Style'>();

const clip = (frames: number) => ({
  type: 'clip' as const,
  id: newId<'TimelineItem'>(),
  media: {
    kind: 'video' as const,
    assetId: newId<'Asset'>(),
    shotId: null,
    available: TimeRange.of(at(0), at(300)),
  },
  sourceStart: at(30),
  duration: at(frames),
  speed: null,
  slotId: null,
  syncPoint: null,
  beatAnchor: null,
  fit: 'cover' as const,
  audio: { gainDb: 0, muted: false },
  locked: false,
  enabled: true,
  stillMotion: null,
  reframe: null,
});

const whip = () => ({
  type: 'transition' as const,
  id: newId<'TimelineItem'>(),
  kind: 'whip' as const,
  inOffset: at(5),
  outOffset: at(5),
  direction: null,
});

function timeline(options: { template?: boolean; styled?: boolean } = {}): Timeline {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: newId<'Timeline'>(),
    projectId: newId<'Project'>(),
    name: 'Goa, variant 1',
    revision: 1,
    canvas: { width: 1080, height: 1920, rate: fps30 },
    template: options.template === false ? null : { id: templateId, version: 3 },
    beatMap: null,
    tracks: [
      {
        kind: 'video',
        id: 'V1',
        name: 'Video',
        enabled: true,
        items: [clip(60), whip(), clip(60), whip(), clip(60)],
      },
    ],
    markers: [],
    cast: null,
    captions: null,
    music: { path: 'platformSound' },
    styleId: options.styled === false ? null : styleId,
    voiceover: null,
    mix: DEFAULT_MIX,
    createdAt: 1,
    updatedAt: 1,
  };
}

function world(document: Timeline, status: RenderFactsRecord['status'] = 'ready') {
  const render: RenderFactsRecord = {
    status,
    timelineId: document.id,
    rate: fps30,
    durationFrames: 450,
    presetId: 'reels',
    music: 'ownTrack',
    createdAt: 1_000,
    finishedAt: 2_000,
  };
  const deps: RenderFactsDeps = {
    renders: { get: async () => ok(render) },
    timelines: {
      get: async () =>
        ok({ json: JSON.parse(JSON.stringify(document)), schemaVersion: TIMELINE_SCHEMA_VERSION }),
    },
    templates: { get: async () => ok({ summary: { name: 'Sunset montage' } }) },
    styles: { get: async () => ok({ name: 'Golden hour' }) },
  };
  return deps;
}

describe('renderFacts', () => {
  const renderId = newId<'Render'>();

  it('reads the template, look and choices that reached the file', async () => {
    expect(unwrap(await renderFacts(world(timeline()), renderId))).toEqual({
      renderId,
      finishedAt: 2_000,
      templateId,
      templateName: 'Sunset montage',
      templateVersion: 3,
      styleId,
      styleName: 'Golden hour',
      presetId: 'reels',
      music: 'ownTrack',
      captions: false,
      clips: 3,
      seconds: 15,
      transitions: ['whip'],
    });
  });

  it('has no facts for a render not ready, an edit without a template, or a template since deleted', async () => {
    expect(unwrap(await renderFacts(world(timeline(), 'failed'), renderId))).toBeUndefined();
    expect(unwrap(await renderFacts(world(timeline({ template: false })), renderId))).toBeUndefined();
    const gone = {
      ...world(timeline()),
      templates: { get: async () => err(NotFoundError({ entity: 'template' })) },
    };
    expect(unwrap(await renderFacts(gone, renderId))).toBeUndefined();
  });

  it('passes on a store it cannot read and a timeline that does not hold', async () => {
    const failing = err({ code: 'library.query_failed', messageKey: 'x', retryable: true });
    const broken = { ...world(timeline()), styles: { get: async () => failing } };
    expect(await renderFacts(broken, renderId)).toMatchObject({
      ok: false,
      error: { code: 'library.query_failed' },
    });
    const bad = {
      ...world(timeline()),
      timelines: { get: async () => ok({ json: { tracks: 1 }, schemaVersion: TIMELINE_SCHEMA_VERSION }) },
    };
    expect(await renderFacts(bad, renderId)).toMatchObject({ ok: false, error: { code: 'core.validation' } });
  });
});

const facts = (renderId: RenderId, finishedAt: number, options: Partial<RenderFacts> = {}): RenderFacts => ({
  renderId,
  finishedAt,
  templateId,
  templateName: 'Sunset montage',
  templateVersion: 3,
  styleId: null,
  styleName: null,
  presetId: 'reels',
  music: 'platformSound',
  captions: true,
  clips: 8,
  seconds: 21,
  transitions: [],
  ...options,
});

/** A memory store and command bus over one array, the way the agent root wires the real ones. */
function recorderWorld(known: RenderFacts[]) {
  const items: MemoryItemView[] = [];
  const keys: string[] = [];
  const settings = createMemorySettingsStore();
  const commands: WhatWorkedDeps['commands'] = {
    async dispatch(command, payload, _origin, options) {
      if (options?.idempotencyKey) keys.push(options.idempotencyKey);
      const p = payload as {
        memoryId: MemoryItemView['id'];
        item?: MemoryItemView;
        patch?: Partial<MemoryItemView>;
      };
      if (command === MEMORY_COMMANDS.create && p.item)
        items.push(memoryView(p.item.text, { ...p.item, id: p.memoryId }));
      if (command === MEMORY_COMMANDS.update) {
        const at = items.findIndex((item) => item.id === p.memoryId);
        items[at] = { ...items[at]!, ...p.patch, revision: items[at]!.revision + 1 };
      }
      return ok({ applied: true });
    },
  };
  const recorder = createWhatWorkedRecorder({
    facts: async (renderId) => ok(known.find((entry) => entry.renderId === renderId)),
    store: {
      list: async (filter) =>
        ok(
          items.filter(
            (item) =>
              item.data?.kind === filter?.dataKind &&
              JSON.stringify(filter?.scopes) === JSON.stringify([item.scope]),
          ),
        ),
    },
    commands,
    settings,
    renders: {
      list: async () =>
        ok(
          known
            .map((entry) => ({ id: entry.renderId, status: 'ready' as const, finishedAt: entry.finishedAt }))
            .reverse(),
        ),
    },
  });
  return { items, keys, settings, recorder };
}

describe('the what-worked recorder', () => {
  it('writes one learned item per template and look, refreshed and counted on each export', async () => {
    const [a, b, c] = [newId<'Render'>(), newId<'Render'>(), newId<'Render'>()];
    const look = newId<'Style'>();
    const w = recorderWorld([
      facts(a, 10),
      facts(b, 20, { transitions: ['whip', 'crossfade'] }),
      facts(c, 30, { styleId: look, styleName: 'Golden hour' }),
    ]);
    expect(unwrap(await w.recorder.record(a))).toBe('created');
    expect(unwrap(await w.recorder.record(b))).toBe('updated');
    expect(unwrap(await w.recorder.record(b))).toBe('recorded-before');
    expect(unwrap(await w.recorder.record(c))).toBe('created');
    expect(unwrap(await w.recorder.record(newId<'Render'>()))).toBe('no-template');
    expect(w.items).toHaveLength(2);
    expect(w.items[0]).toMatchObject({
      scope: { kind: 'template', templateId },
      source: 'learned',
      revision: 2,
      data: {
        kind: 'what-worked',
        templateVersion: 3,
        styleId: null,
        presetId: 'reels',
        renderId: b,
        exports: 2,
      },
    });
    expect(w.items[0]!.text).toBe(
      '“Sunset montage” (version 3) reached a finished export for Instagram Reels: 8 clips in 21 s, whip, crossfade ' +
        "transitions, captions on, the platform's sound added later. Exported 2 times.",
    );
    expect(w.items[1]!.text).toContain('with the “Golden hour” look');
    expect(w.keys).toContain(`memory.whatWorked:${a}`);
    expect(unwrap(await w.settings.get(WHAT_WORKED_SEEN_SETTING))).toBe(30);
  });

  it('catches up on exports after the watermark, oldest first, and never records one twice', async () => {
    const [a, b] = [newId<'Render'>(), newId<'Render'>()];
    const w = recorderWorld([facts(a, 10), facts(b, 20)]);
    unwrap(await w.settings.set(WHAT_WORKED_SEEN_SETTING, 10));
    expect(unwrap(await w.recorder.catchUp())).toBe(1);
    expect(w.items[0]!.data).toMatchObject({ renderId: b, exports: 1 });
    // The creator deletes the item; nothing brings it back.
    w.items.length = 0;
    expect(unwrap(await w.recorder.catchUp())).toBe(0);
    expect(w.items).toEqual([]);
  });

  it('names a long template or look in short', () => {
    const name = 'x'.repeat(120);
    const text = whatWorkedText(facts(newId<'Render'>(), 1, { templateName: name, music: 'generated' }), 1);
    expect(text).toContain(`“${'x'.repeat(79)}…”`);
    expect(text).toContain('straight cuts');
    expect(text).toContain('Exported once.');
  });
});
