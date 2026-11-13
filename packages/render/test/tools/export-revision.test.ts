// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-M13: the export approval is for one timeline revision, the one the card
 * shows. render.export takes that revision, the card refuses to show another
 * one, the command refuses to export another one, and a new revision is a new
 * action (its own idempotency key), so it goes through the approval again.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  newId,
  ok,
  unwrap,
  type CommandToolContext,
  type JobRunner,
} from '@taalcut/core';
import { createRenderCommands } from '../../src/commands/render-commands';
import { renderToolModule } from '../../src/tools/render-tools';
import { memoryRenderStore } from '../support/render-store';
import { makeTimeline } from '../support/timeline';
import { AGENT, memoryTimelines, recordingEnqueuer, renderRow } from '../commands/support';

function setup(revision = 1) {
  const timeline = { ...makeTimeline({ items: [{ frames: 90 }] }), revision };
  const store = memoryRenderStore();
  const timelines = memoryTimelines(timeline);
  const clock = createManualClock(1_000);
  const settings = createMemorySettingsStore();
  const commands = createRenderCommands({ store, enqueuer: recordingEnqueuer(), timelines, settings, clock });
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
  bus.register(...commands.all);
  const jobs: JobRunner = { run: async (_kind, input) => ok(input as never) };
  const module = renderToolModule({ store, timelines, settings, jobs });
  const tool = (name: string) => module.tools.find((candidate) => candidate.name === name)!;
  const dispatched: unknown[] = [];
  const ctx = {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    runId: newId<'AgentRun'>(),
    attempt: 1,
    artifacts: { put: async () => ok(null as never), get: async () => ok(null as never) },
    reportUsage: () => undefined,
    reportProgress: () => undefined,
    dispatch: async (payload: unknown) => {
      dispatched.push(payload);
      const receipt = await bus.dispatch('render.export', payload, AGENT);
      return receipt.ok ? ok(receipt.value.result) : receipt;
    },
  } as unknown as CommandToolContext;
  const edit = async () =>
    unwrap(await timelines.update(timeline.id, (t) => ({ ...t, name: `${t.name} (edited)` })));
  const cardCtx = {
    runId: newId<'AgentRun'>(),
    toolCallId: newId<'ToolRun'>(),
    projectId: timeline.projectId,
    signal: new AbortController().signal,
    approvalId: 'a1',
  };
  return { timeline, store, tool, ctx, dispatched, edit, cardCtx, bus };
}

describe('render.export and the timeline revision on its card', () => {
  it('does not attach revision 17 preview or QA to approval for revision 36', async () => {
    const t = setup(36);
    const old = renderRow({
      projectId: t.timeline.projectId,
      timelineId: t.timeline.id,
      timelineRevision: 17,
      status: 'ready',
      qa: { verdict: 'passed', round: 1, passed: 20, warned: 0, failed: 0, fixed: 0, failing: [] },
      createdAt: 2_000,
    });
    t.store.records.set(old.id, old);
    const input = { projectId: t.timeline.projectId, timelineId: t.timeline.id, timelineRevision: 36 };
    const card = unwrap(await t.tool('render.export').approvalCard!(input, t.cardCtx));
    expect(card).toMatchObject({ type: 'exportApproval', timelineRevision: 36, draft: null });

    // A newly finished job for an old revision must not hide the matching draft.
    const matching = renderRow({ ...old, id: newId<'Render'>(), timelineRevision: 36, createdAt: 1_000 });
    t.store.records.set(matching.id, matching);
    const current = unwrap(await t.tool('render.export').approvalCard!(input, t.cardCtx));
    expect(current).toMatchObject({
      type: 'exportApproval',
      timelineRevision: 36,
      draft: { renderId: matching.id, qa: matching.qa },
    });
  });

  it('shows the revision it was asked for, and refuses a card for one the timeline has moved past', async () => {
    const t = setup();
    const input = { projectId: t.timeline.projectId, timelineId: t.timeline.id, timelineRevision: 1 };
    const card = unwrap(await t.tool('render.export').approvalCard!(input, t.cardCtx));
    expect(card).toMatchObject({ type: 'exportApproval', timelineRevision: 1 });
    await t.edit();
    const stale = await t.tool('render.export').approvalCard!(input, t.cardCtx);
    expect(stale.ok ? stale.value : stale.error.code).toBe('core.conflict');
  });

  it('exports the approved revision; after an edit the same approval is refused, not exported', async () => {
    const t = setup();
    const input = { projectId: t.timeline.projectId, timelineId: t.timeline.id, timelineRevision: 1 };
    await t.edit(); // The user swaps a clip while the card waits.
    const result = await t.tool('render.export').run(input, t.ctx);
    expect(result.ok ? result.value : result.error.code).toBe('core.conflict');
    expect(t.dispatched).toMatchObject([{ timelineId: t.timeline.id, timelineRevision: 1 }]);
    expect(t.store.records.size).toBe(0);

    const current = unwrap(await t.tool('render.export').run({ ...input, timelineRevision: 2 }, t.ctx)) as {
      render: { id: string };
    };
    expect(t.store.records.get(current.render.id as never)?.timelineRevision).toBe(2);
  });

  it('makes a new revision a new action, so a second export in the run is not the first one replayed', () => {
    const t = setup();
    const key = t.tool('render.export').idempotencyKey!;
    const at = (timelineRevision: number) =>
      key({ projectId: t.timeline.projectId, timelineId: t.timeline.id, timelineRevision });
    expect(at(1)).toBe(at(1));
    expect(at(2)).not.toBe(at(1));
  });

  it('needs the revision: the model reads it from render.listPresets', async () => {
    const t = setup();
    const input = { projectId: t.timeline.projectId, timelineId: t.timeline.id };
    expect(t.tool('render.export').input.safeParse(input).success).toBe(false);
    const presets = unwrap(await t.tool('render.listPresets').run(input, t.ctx)) as {
      timelineRevision: number;
    };
    expect(presets.timelineRevision).toBe(1);
  });

  it('offers and forwards the exact 4K 60 fps HEVC request from a 1080p 30 fps timeline', async () => {
    const t = setup();
    const projectId = t.timeline.projectId;
    const offered = unwrap(
      await t.tool('render.listPresets').run({ projectId, timelineId: t.timeline.id }, t.ctx),
    ) as {
      presets: { id: string; width: number; height: number; supportedRates: unknown[]; codecs: string[] }[];
    };
    expect(offered.presets.find((preset) => preset.id === 'master4k')).toMatchObject({
      width: 2160,
      height: 3840,
      supportedRates: expect.arrayContaining([{ num: 60, den: 1 }]),
      codecs: expect.arrayContaining(['h264', 'hevc']),
    });
    const choose = t.tool('render.setExportPreset');
    const settings = choose.input.parse({ projectId, presetId: 'master4k', codec: 'hevc' });
    unwrap(
      await choose.run(settings, {
        ...t.ctx,
        dispatch: async (payload: unknown) => {
          const result = await t.bus.dispatch('render.setExportPreset', payload, AGENT);
          return result.ok ? ok(result.value.result) : result;
        },
      } as CommandToolContext),
    );
    const exportTool = t.tool('render.export');
    const input = {
      projectId,
      timelineId: t.timeline.id,
      timelineRevision: 1,
      rate: { num: 60, den: 1 },
    };
    expect(exportTool.input.safeParse(input).success).toBe(true);
    // Offered schemas must remain provider-compatible: core's transforming rate schema cannot be used here.
    expect(() => z.toJSONSchema(exportTool.input)).not.toThrow();
    const output = unwrap(await exportTool.run(input, t.ctx)) as {
      render: { id: string; rate: unknown; durationFrames: number };
    };
    expect(t.dispatched).toMatchObject([{ presetId: 'master4k', codec: 'hevc', rate: { num: 60, den: 1 } }]);
    expect(output.render).toMatchObject({ rate: { num: 60, den: 1 }, durationFrames: 180 });
    expect(t.store.records.get(output.render.id as never)).toMatchObject({ width: 2160, height: 3840 });
    expect(exportTool.idempotencyKey!(input)).not.toBe(
      exportTool.idempotencyKey!({ ...input, rate: { num: 30, den: 1 } }),
    );
  });
});
