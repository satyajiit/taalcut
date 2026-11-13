// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Render commands on the real command bus: export dedupes and enqueues, cancel marks, undo is exact. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  FrameRate,
  NotFoundError,
  unwrap,
  type EventPayload,
  type RenderId,
  type Timeline,
} from '@taalcut/core';
import { createRenderCommands } from '../../src/commands/render-commands';
import { exportRequestKey } from '../../src/commands/request';
import { renderExportJobKey, renderPurgeJobKey } from '../../src/jobs/render-jobs';
import { autoFix, checkResult } from '../../src/qa/result';
import { exportSettingFor } from '../../src/settings';
import { renderDestination, renderWorkFile, renderWorkSidecar } from '../../src/store/paths';
import { tempDir } from '../support/media';
import { memoryRenderStore } from '../support/render-store';
import { makeTimeline } from '../support/timeline';
import { report } from '../qa/support';
import { AGENT, memoryTimelines, recordingEnqueuer, UI } from './support';

let work: Awaited<ReturnType<typeof tempDir>>;
beforeEach(async () => {
  work = await tempDir('render-commands');
});
afterEach(() => work.dispose());

function setup(timeline: Timeline = makeTimeline({ items: [{ frames: 90 }] })) {
  const store = memoryRenderStore();
  const enqueuer = recordingEnqueuer();
  const settings = createMemorySettingsStore();
  const clock = createManualClock(5_000);
  const events: EventPayload<'render.finished'>[] = [];
  const folders = { work: join(work.dir, 'work'), renders: join(work.dir, 'renders') };
  const commands = createRenderCommands({
    store,
    enqueuer,
    timelines: memoryTimelines(timeline),
    settings,
    clock,
    folders,
    events: { emit: (_type, payload) => events.push(payload as EventPayload<'render.finished'>) },
  });
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
  bus.register(...commands.all);
  const request = {
    projectId: timeline.projectId,
    timelineId: timeline.id,
    presetId: 'shorts' as const,
    captions: { burnIn: true, sidecars: ['srt' as const] },
  };
  return { store, enqueuer, settings, clock, events, folders, commands, bus, request, timeline };
}

describe('render.export', () => {
  it('creates the queued render and enqueues its job, keyed by the render', async () => {
    const { bus, commands, store, enqueuer, request, timeline } = setup();
    const receipt = unwrap(await bus.dispatch(commands.export, request, UI));
    const { renderId, jobId } = receipt.result;
    const row = store.records.get(renderId)!;
    expect(row).toMatchObject({
      status: 'queued',
      jobId,
      timelineRevision: timeline.revision,
      presetId: 'shorts',
      durationFrames: 90,
      name: 'Render test – YouTube Shorts',
      music: 'platformSound',
      createdAt: 5_000,
    });
    expect(row.request.timelineRevision).toBe(timeline.revision);
    expect(row.requestKey).toBe(exportRequestKey(row.request));
    expect(enqueuer.requests).toEqual([
      {
        kind: 'render.export',
        input: { renderId, request: row.request },
        projectId: timeline.projectId,
        idempotencyKey: renderExportJobKey(renderId),
      },
      // The daily cache purge rides along.
      { kind: 'render.purge', input: {}, priority: 'low', idempotencyKey: renderPurgeJobKey(5_000) },
    ]);
    expect(receipt.undoable).toBe(false);
  });

  it('returns the live render for the same request, and turns notify on when asked', async () => {
    const { bus, commands, store, enqueuer, request } = setup();
    const first = unwrap(await bus.dispatch(commands.export, request, UI)).result;
    const again = unwrap(await bus.dispatch(commands.export, { ...request, notify: true }, AGENT)).result;
    expect(again).toEqual(first);
    expect(enqueuer.requests.filter((job) => job.kind === 'render.export')).toHaveLength(1);
    expect(store.records.get(first.renderId)!.notify).toBe(true);
    // A different caption output is a different file: a new render.
    const other = unwrap(
      await bus.dispatch(commands.export, { ...request, captions: { burnIn: false, sidecars: [] } }, UI),
    );
    expect(other.result.renderId).not.toBe(first.renderId);
    // Once cancelled, the same request renders again.
    await store.update(first.renderId, { status: 'cancelled' });
    const fresh = unwrap(await bus.dispatch(commands.export, request, UI)).result;
    expect(fresh.renderId).not.toBe(first.renderId);
  });

  it('refuses a timeline too long for the preset, another revision, and an unsupported rate', async () => {
    const long = makeTimeline({ items: [{ frames: 30 * 200 }] });
    const { bus, commands, request } = setup(long);
    const tooLong = await bus.dispatch(commands.export, request, UI);
    expect(tooLong.ok ? null : tooLong.error).toMatchObject({
      code: 'render.duration_out_of_range',
      params: { presetId: 'shorts', maxSeconds: 179 },
    });
    expect((await bus.dispatch(commands.export, { ...request, presetId: 'device' }, UI)).ok).toBe(true);
    const stale = await bus.dispatch(
      commands.export,
      { ...request, presetId: 'device', timelineRevision: 9 },
      UI,
    );
    expect(stale.ok ? null : stale.error.code).toBe('core.conflict');
    const rate = await bus.dispatch(
      commands.export,
      { ...request, presetId: 'device', rate: FrameRate.of(50) },
      UI,
    );
    expect(rate.ok ? null : rate.error.code).toBe('render.unsupported_frame_rate');
  });

  it('queues 60 fps with twice the frames and the same duration, without editing its 30 fps timeline', async () => {
    const { bus, commands, store, request, timeline } = setup();
    const first = unwrap(await bus.dispatch(commands.export, request, UI)).result;
    const outputRate = FrameRate.of(60);
    const conformed = unwrap(
      await bus.dispatch(commands.export, { ...request, rate: outputRate }, UI),
    ).result;
    const row = store.records.get(conformed.renderId)!;
    expect(row).toMatchObject({ durationFrames: 180, rate: outputRate, timelineRevision: 1 });
    expect(row.request.rate).toEqual(outputRate);
    expect(row.durationFrames / row.rate.num).toBe(3);
    expect(conformed.renderId).not.toBe(first.renderId);
    expect(timeline.canvas.rate).toEqual(FrameRate.of(30));
    expect(timeline.revision).toBe(1);
  });

  it('marks the render failed when the queue refuses the job', async () => {
    const { bus, commands, store, enqueuer, request, events } = setup();
    enqueuer.failWith = NotFoundError(
      { entity: 'job kind', id: 'render.export' },
      { detail: 'not registered' },
    );
    const result = await bus.dispatch(commands.export, request, UI);
    expect(result.ok ? null : result.error.code).toBe('core.not_found');
    const [row] = store.records.values();
    expect(row).toMatchObject({ status: 'failed', error: { code: 'core.not_found' }, finishedAt: 5_000 });
    expect(row!.error).not.toHaveProperty('detail');
    expect(events.map((event) => event.status)).toEqual(['failed']);
  });
});

describe('render.cancel, setNotify, setExportPreset, delete', () => {
  it('cancels a queued render (announcing it) and leaves a finished one alone', async () => {
    const { bus, commands, store, request, events, clock } = setup();
    const { renderId } = unwrap(await bus.dispatch(commands.export, request, UI)).result;
    clock.advance(1_000);
    const cancelled = unwrap(
      await bus.dispatch(commands.cancel, { projectId: request.projectId, renderId }, AGENT),
    );
    expect(cancelled.result).toEqual({ renderId, status: 'cancelled' });
    expect(store.records.get(renderId)).toMatchObject({ status: 'cancelled', finishedAt: 6_000 });
    expect(events).toEqual([expect.objectContaining({ renderId, status: 'cancelled' })]);
    const again = unwrap(await bus.dispatch(commands.cancel, { projectId: request.projectId, renderId }, UI));
    expect(again.result.status).toBe('cancelled');
    expect(events).toHaveLength(1);
  });

  it('undoes notify and the export settings exactly', async () => {
    const { bus, commands, store, request, settings } = setup();
    const { renderId } = unwrap(await bus.dispatch(commands.export, request, UI)).result;
    const projectId = request.projectId;
    unwrap(await bus.dispatch(commands.setNotify, { projectId, renderId, notify: true }, UI));
    expect(store.records.get(renderId)!.notify).toBe(true);
    unwrap(await bus.undo(projectId, UI));
    expect(store.records.get(renderId)!.notify).toBe(false);

    unwrap(await bus.dispatch(commands.setExportPreset, { projectId, presetId: 'reels' }, UI));
    const setting = exportSettingFor(projectId);
    expect(unwrap(await settings.get(setting))).toEqual({
      presetId: 'reels',
      captions: { burnIn: true, sidecars: [] },
      contentCredentials: { add: false },
      includeBumpers: true,
    });
    unwrap(await bus.undo(projectId, UI));
    expect(unwrap(await settings.get(setting)).presetId).toBe('device');
    unwrap(await bus.redo(projectId, UI));
    expect(unwrap(await settings.get(setting)).presetId).toBe('reels');
  });

  it('soft-deletes (cancelling a running render) and restores on undo', async () => {
    const { bus, commands, store, request } = setup();
    const { renderId } = unwrap(await bus.dispatch(commands.export, request, UI)).result;
    await store.update(renderId, { status: 'rendering' });
    const projectId = request.projectId;
    unwrap(await bus.dispatch(commands.delete, { projectId, renderId }, UI));
    expect(store.records.get(renderId)).toMatchObject({ deletedAt: 5_000, status: 'cancelled' });
    unwrap(await bus.undo(projectId, UI));
    expect(store.records.get(renderId)!.deletedAt).toBeNull();
    unwrap(await bus.redo(projectId, UI));
    expect(store.records.get(renderId)!.deletedAt).toBe(5_000);
    const restore = await bus.dispatch(commands.restore, { projectId, renderId }, UI);
    expect(restore.ok ? null : restore.error.code).toBe('core.internal_command');
  });
});

describe('render.overrideQa', () => {
  const fail = (id: 'loudness' | 'blackFrames' | 'codec') =>
    checkResult(id, 'fail', { fixes: [autoFix('rerender')] }, 0);

  async function needsAttention(checks: ReturnType<typeof fail>[]) {
    const env = setup();
    const { renderId } = unwrap(await env.bus.dispatch(env.commands.export, env.request, UI)).result;
    const qaReport = report(checks, { renderId });
    await env.store.update(renderId, { status: 'needsAttention', qaReport });
    return { ...env, renderId, payload: { projectId: env.request.projectId, renderId } };
  }

  it('is refused from the agent', async () => {
    const { bus, commands, payload } = await needsAttention([fail('loudness')]);
    const refused = await bus.dispatch(commands.overrideQa, { ...payload, checks: ['loudness'] }, AGENT);
    expect(refused.ok ? null : refused.error.code).toBe('core.command_source_refused');
  });

  it('keeps needsAttention while a failure remains, and refuses a check that may not be overridden', async () => {
    const { bus, commands, store, payload, renderId } = await needsAttention([
      fail('loudness'),
      fail('blackFrames'),
    ]);
    const partial = unwrap(await bus.dispatch(commands.overrideQa, { ...payload, checks: ['loudness'] }, UI));
    expect(partial.result).toEqual({ renderId, status: 'needsAttention', verdict: 'needsAttention' });
    expect(store.records.get(renderId)!.qaReport!.overrides.map((entry) => entry.check)).toEqual([
      'loudness',
    ]);
    const codec = await needsAttention([fail('codec')]);
    const refused = await codec.bus.dispatch(
      codec.commands.overrideQa,
      { ...codec.payload, checks: ['codec'] },
      UI,
    );
    expect(refused.ok ? null : refused.error.code).toBe('render.override_refused');
  });

  it('delivers the waiting file with its sidecar once every failure is overridden', async () => {
    const { bus, commands, store, payload, renderId, folders, events, request } = await needsAttention([
      fail('loudness'),
    ]);
    const id = renderId as RenderId;
    await mkdir(join(folders.work, id), { recursive: true });
    await writeFile(renderWorkFile(folders, id), 'mp4 bytes');
    await writeFile(renderWorkSidecar(folders, id, 'srt'), '1\n');
    const done = unwrap(await bus.dispatch(commands.overrideQa, { ...payload, checks: ['loudness'] }, UI));
    expect(done.result).toEqual({ renderId, status: 'ready', verdict: 'overridden' });
    const destination = renderDestination(folders, request.projectId, id);
    expect(await readFile(destination, 'utf8')).toBe('mp4 bytes');
    expect(await readFile(renderDestination(folders, request.projectId, id, 'srt'), 'utf8')).toBe('1\n');
    expect(store.records.get(id)).toMatchObject({ filePath: destination, bytes: 9 });
    expect(events.at(-1)).toMatchObject({ renderId, status: 'ready' });
  });

  it('refuses a render that is not waiting for attention', async () => {
    const { bus, commands, request } = setup();
    const { renderId } = unwrap(await bus.dispatch(commands.export, request, UI)).result;
    const refused = await bus.dispatch(
      commands.overrideQa,
      { projectId: request.projectId, renderId, checks: ['loudness'] },
      UI,
    );
    expect(refused.ok ? null : refused.error.code).toBe('render.not_ready');
  });
});
