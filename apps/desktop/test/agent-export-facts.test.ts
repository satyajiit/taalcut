// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * export.completed's facts in the agent process (P2-X7): the exported
 * revision against the assembly's result (the timeline's oldest version),
 * read through the library's stores, and the first export remembered once.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createContainer,
  FrameRates,
  newId,
  ok,
  RationalTime,
  RenderStoreToken,
  TimelineStoreToken,
  TimeRange,
  type RenderStore,
  type TimelineStore,
} from '@taalcut/core';
import { flowExportFacts } from '../src/utility/roots/agent-export-facts';
import type { UtilityConfig } from '../src/shared/rpc-ipc';
import { UtilityConfigToken } from '../src/shared/tokens';

const rate = FrameRates.fps30;
const at = (frames: number) => RationalTime.of(frames, rate);

function timeline(
  revision: number,
  picks: readonly string[],
  shown: readonly string[],
  userPicks: readonly number[],
) {
  const slots = picks.map(() => newId<'TemplateSlot'>());
  const assets = new Map<string, string>();
  const asset = (shot: string) => assets.get(shot) ?? (assets.set(shot, newId<'Asset'>()), assets.get(shot)!);
  const clips = shown.map((shot, i) => ({
    type: 'clip',
    id: newId<'TimelineItem'>(),
    media: { kind: 'video', assetId: asset(shot), shotId: shot, available: TimeRange.of(at(0), at(300)) },
    sourceStart: at(0),
    duration: at(30),
    speed: null,
    slotId: slots[i],
    syncPoint: null,
    beatAnchor: null,
    fit: 'cover',
    audio: { gainDb: 0, muted: true },
    locked: false,
    enabled: true,
  }));
  const candidate = (shot: string) => ({
    assetId: asset(shot),
    shotId: shot,
    sourceStart: at(0),
    syncPoint: null,
    score: 1,
    parts: { intent: 1, motion: 1, quality: 1, subject: 1, energy: 1, hook: null, rerank: null, penalty: 0 },
  });
  return {
    schemaVersion: 1,
    id: TIMELINE_ID,
    projectId: PROJECT_ID,
    name: 'Trip',
    revision,
    canvas: { width: 1080, height: 1920, rate },
    template: { id: TEMPLATE_ID, version: 1 },
    beatMap: null,
    tracks: [{ kind: 'video', id: 'V1', name: 'V1', enabled: true, items: clips }],
    markers: [],
    cast: {
      castId: CAST_ID,
      mode: 'template',
      variantIndex: 0,
      variantCount: 1,
      configVersion: 'test',
      sequenceConfidence: 1,
      slots: slots.map((slotId, i) => ({
        slotId,
        clipId: clips[i]!.id,
        pick: candidate(userPicks.includes(i) ? shown[i]! : picks[i]!),
        alternates: [],
        confidence: 0.8,
        needsRerank: false,
        note: userPicks.includes(i) ? 'userPick' : null,
      })),
    },
    captions: null,
    music: { path: 'platformSound' },
    createdAt: 1,
    updatedAt: 1,
  };
}

const PROJECT_ID = newId<'Project'>();
const TIMELINE_ID = newId<'Timeline'>();
const TEMPLATE_ID = newId<'Template'>();
const CAST_ID = newId<'Cast'>();
const shot = () => newId<'Shot'>() as string;

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function facts(assembled: unknown, exported: { revision: number }) {
  const userData = mkdtempSync(join(tmpdir(), 'taalcut-export-facts-'));
  dirs.push(userData);
  const versionId = newId<'TimelineVersion'>();
  const timelines = {
    get: async () => ok({ summary: {}, schemaVersion: 1, json: exported }),
    versions: {
      list: () => ok({ items: [{ id: versionId, revision: 1 }] }),
      get: () => ok({ summary: {}, schemaVersion: 1, json: assembled, documentHash: 'x' }),
    },
  } as unknown as TimelineStore;
  const renders = {
    get: async () => ok({ timelineRevision: exported.revision }),
  } as unknown as RenderStore;
  const container = createContainer()
    .value(TimelineStoreToken, timelines)
    .value(RenderStoreToken, renders)
    .value(UtilityConfigToken, { userData } as UtilityConfig);
  const port = flowExportFacts(container)!;
  const input = { projectId: PROJECT_ID, timelineId: TIMELINE_ID, renderId: newId<'Render'>() };
  return () => port.facts(input);
}

describe('flowExportFacts', () => {
  it('compares the export with the assembly: a kept slot, a user swap; the first export once', async () => {
    const [a, b] = [shot(), shot()];
    const assembled = timeline(1, [a, b], [a, b], []);
    const exported = { ...timeline(3, [a, b], [a, shot()], [1]), id: TIMELINE_ID };
    // The two documents share slot ids in the store: the exported one keeps the assembly's.
    exported.tracks[0]!.items.forEach((clip, i) => (clip.slotId = assembled.tracks[0]!.items[i]!.slotId));
    exported.cast.slots.forEach((slot, i) => (slot.slotId = assembled.cast.slots[i]!.slotId));
    const read = facts(assembled, exported);
    expect(await read()).toEqual({
      slots: 2,
      slotsKeptAi: 1,
      slotsSwappedByUser: 1,
      orderChanged: false,
      breakdownEdited: false,
      firstExport: true,
    });
    expect((await read())?.firstExport).toBe(false);
  });

  it('is not there without the stores it reads', () => {
    expect(flowExportFacts(createContainer())).toBeUndefined();
  });
});
