// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * render.export keeps the exported revision as an `export` version before it
 * creates the render, and the export later reads exactly that revision even
 * after the timeline was edited.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  err,
  newId,
  ok,
  unwrap,
  ValidationError,
  type AsyncResult,
  type Timeline,
  type TimelineStore,
  type TimelineVersionId,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { createRenderCommands } from '../../src/commands/render-commands';
import { gatherExport } from '../../src/engine/export-inputs';
import { timelineAccessOverStore, type TimelineRevisions } from '../../src/store/timeline-access';
import { testEngine } from '../support/engine';
import { tempDir } from '../support/media';
import { memoryRenderStore } from '../support/render-store';
import { makeTimeline } from '../support/timeline';
import { memoryTimelines, recordingEnqueuer, renderRow, UI } from './support';

let work: Awaited<ReturnType<typeof tempDir>>;
beforeEach(async () => {
  work = await tempDir('export-versions');
});
afterEach(() => work.dispose());

type SnapshotInput = { timelineId: Timeline['id']; revision: number; label: string };

function setup(snapshot: (input: SnapshotInput) => AsyncResult<unknown>) {
  const timeline = makeTimeline({ items: [{ frames: 90 }] });
  const store = memoryRenderStore();
  const enqueuer = recordingEnqueuer();
  const snapshots: SnapshotInput[] = [];
  const clock = createManualClock(5_000);
  const commands = createRenderCommands({
    store,
    enqueuer,
    timelines: memoryTimelines(timeline),
    settings: createMemorySettingsStore(),
    clock,
    folders: { work: `${work.dir}/work`, renders: `${work.dir}/renders` },
    events: { emit: () => undefined },
    snapshotExport: (input) => {
      snapshots.push(input);
      return snapshot(input);
    },
  });
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
  bus.register(...commands.all);
  const request = {
    projectId: timeline.projectId,
    timelineId: timeline.id,
    presetId: 'shorts' as const,
    captions: { burnIn: true, sidecars: [] },
  };
  return { timeline, store, enqueuer, snapshots, commands, bus, request };
}

describe('render.export keeps an export version', () => {
  it("snapshots the exported revision under the render's name, once per render", async () => {
    const { timeline, snapshots, commands, bus, request, store } = setup(async () => ok(null));
    const receipt = unwrap(await bus.dispatch(commands.export, request, UI));
    expect(snapshots).toEqual([
      { timelineId: timeline.id, revision: timeline.revision, label: 'Render test – YouTube Shorts' },
    ]);
    expect(store.records.get(receipt.result.renderId)?.name).toBe('Render test – YouTube Shorts');
    // The same export again is the same render: no second version.
    unwrap(await bus.dispatch(commands.export, request, UI));
    expect(snapshots).toHaveLength(1);
  });

  it('refuses the export when the version cannot be kept: no render, no job', async () => {
    const { commands, bus, request, store, enqueuer } = setup(async () =>
      err(ValidationError({ field: 'label' })),
    );
    const result = await bus.dispatch(commands.export, request, UI);
    expect(result.ok ? null : result.error.code).toBe('core.validation');
    expect(store.records.size).toBe(0);
    expect(enqueuer.requests).toHaveLength(0);
  });
});

/** The working copy at revision 3 and saved versions of revisions 3, 2 and 1, two to a page (newest first). */
function versionedStore(revisions: Timeline[]) {
  const ids = new Map(revisions.map((timeline) => [newId<'TimelineVersion'>(), timeline]));
  const items = [...ids].map(([id, timeline]) => ({ id, revision: timeline.revision }));
  const working = revisions[0]!;
  const store = {
    get: async () => ok({ json: working, schemaVersion: working.schemaVersion }),
  } as unknown as TimelineStore;
  const versions: TimelineRevisions = {
    list(_timelineId, page) {
      const start = page?.cursor ? Number(page.cursor) : 0;
      const end = start + 2;
      return ok({
        items: items.slice(start, end),
        ...(end < items.length ? { nextCursor: String(end) } : {}),
      });
    },
    get(id: TimelineVersionId) {
      const timeline = ids.get(id)!;
      return ok({ schemaVersion: timeline.schemaVersion, json: timeline });
    },
  };
  return { store, versions };
}

describe('a render of an earlier revision', () => {
  const first = makeTimeline({ items: [{ frames: 90 }] });
  const revisions = [3, 2, 1].map((revision) => ({ ...first, revision, name: `Revision ${revision}` }));

  it('reads the saved version of exactly that revision, across pages', async () => {
    const { store, versions } = versionedStore(revisions);
    const access = timelineAccessOverStore(store, { versions });
    const found = unwrap(await access.atRevision!(first.id, 1));
    expect(found).toMatchObject({ revision: 1, name: 'Revision 1' });
    const missing = await access.atRevision!(first.id, 7);
    expect(missing.ok ? null : missing.error.code).toBe('core.not_found');
  });

  it('exports the revision it was asked for after later edits, and says the timeline changed without versions', async () => {
    const { store, versions } = versionedStore(revisions);
    const record = renderRow({ projectId: first.projectId, timelineId: first.id, timelineRevision: 2 });
    const engine = testEngine(work.dir, {} as MediaContext, '/no-shell', {
      timelines: timelineAccessOverStore(store, { versions }),
    });
    const inputs = unwrap(await gatherExport(engine.deps, record));
    expect(inputs.timeline).toMatchObject({ revision: 2, name: 'Revision 2' });

    const without = testEngine(work.dir, {} as MediaContext, '/no-shell', {
      timelines: timelineAccessOverStore(store),
    });
    const refused = await gatherExport(without.deps, record);
    expect(refused.ok ? null : refused.error.code).toBe('render.timeline_changed');
  });

  it('includes proposed composition graphics in gatherExport so exports match the editor preview', async () => {
    const compId = newId<'GraphicComposition'>();
    const hash = 'a'.repeat(64);
    const withProposed: Timeline = {
      ...first,
      tracks: [
        ...first.tracks,
        {
          kind: 'text',
          id: 'T1',
          name: 'Graphics',
          enabled: true,
          items: [
            {
              type: 'graphic',
              id: newId<'TimelineItem'>(),
              anchor: { kind: 'time', at: { value: 0, rate: first.canvas.rate } },
              start: { value: 0, rate: first.canvas.rate },
              duration: { value: 60, rate: first.canvas.rate },
              placement: { box: { x: 0, y: 0, width: 1, height: 1 } },
              styleKey: 'composition',
              language: 'en',
              origin: 'agent',
              proposal: { request: 'add a chat bubble', design: 'designed', createdAt: 1 },
              composition: { id: compId, hash, params: { message: 'Hello' } },
            },
          ],
        },
      ],
      graphicCompositions: [
        {
          id: compId,
          version: 1,
          hash,
          name: 'Bubble',
          entry: 'bubble/index.html',
          files: [{ path: 'bubble/index.html', sha256: hash, bytes: 10 }],
          variables: [{ type: 'text', name: 'message', maxLength: 500, sample: 'Hello' }],
          durationSeconds: 2,
          provenance: { model: null, overlays: [], brief: null, createdAt: 1 },
          gate: { version: 'hfw1.1', passed: true, checkedAt: 1, hfLint: { errors: 0, warnings: 0 }, checks: [], loweredTweens: 1 },
        },
      ],
    };
    const { store } = versionedStore([withProposed]);
    const record = renderRow({ projectId: withProposed.projectId, timelineId: withProposed.id, timelineRevision: withProposed.revision });
    const engine = testEngine(work.dir, {} as MediaContext, '/no-shell', {
      timelines: timelineAccessOverStore(store),
    });
    const inputs = unwrap(await gatherExport(engine.deps, record));
    expect(inputs.plan.compositions).toHaveLength(1);
    expect(inputs.plan.compositions?.[0]?.values).toEqual({ message: 'Hello' });
  });
});
