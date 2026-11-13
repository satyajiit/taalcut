// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * video.done (AGT2-MATCH): the Maker's finish reads the timeline's newest finished render and refuses, as design.done
 * does, while it is of another revision or while a slot fails a slot-match check without a reason; the refusal names
 * the slot by the template's number and what to change. It is a read that never asks.
 */
import { describe, expect, it } from 'vitest';
import {
  err,
  newId,
  NotImplementedError,
  ok,
  type ArtifactId,
  type CommandToolContext,
  type QaCheckResult,
  type Timeline,
} from '@taalcut/core';
import { agentFix, checkResult } from '../../src/qa/result';
import {
  createVideoDoneLedger,
  makerDone,
  videoToolModule,
  type VideoDoneDeps,
  type VideoDoneLedger,
} from '../../src/tools/video-done-tool';
import { memoryTimelines, renderRow } from '../commands/support';
import { report } from '../qa/support';
import { memoryRenderStore } from '../support/render-store';
import { makeTimeline } from '../support/timeline';

function setup(checks: readonly QaCheckResult[], revisionOffset = 0, ledger?: VideoDoneLedger) {
  const base = makeTimeline({ items: [{ frames: 30 }, { frames: 30 }] });
  const slots = [newId<'TemplateSlot'>(), newId<'TemplateSlot'>()];
  const v1 = base.tracks[0]!;
  const timeline = {
    ...base,
    template: { id: newId<'Template'>(), version: 1 },
    tracks: [
      {
        ...v1,
        items: v1.kind === 'video' ? v1.items.map((item, index) => ({ ...item, slotId: slots[index]! })) : [],
      },
      ...base.tracks.slice(1),
    ],
  } as Timeline;
  const store = memoryRenderStore();
  const older = renderRow({
    projectId: timeline.projectId,
    timelineId: timeline.id,
    status: 'ready',
    createdAt: 1,
  });
  const newest = renderRow({
    projectId: timeline.projectId,
    timelineId: timeline.id,
    timelineRevision: timeline.revision + revisionOffset,
    status: 'needsAttention',
    createdAt: 5,
    qaReport: report(checks),
  });
  // A render still running isn't a draft yet.
  const running = renderRow({
    projectId: timeline.projectId,
    timelineId: timeline.id,
    status: 'rendering',
    createdAt: 9,
  });
  for (const row of [older, newest, running]) store.records.set(row.id, row);
  // The template numbers its slots in the other order than V1 holds them.
  const deps: VideoDoneDeps = {
    store,
    timelines: memoryTimelines(timeline),
    templateSlots: async () => ok([slots[1]!, slots[0]!]),
    ...(ledger ? { ledger } : {}),
  };
  const module = videoToolModule(deps);
  const tool = module.tools[0]!;
  const ctx = {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    runId: newId<'AgentRun'>(),
    attempt: 1,
    artifacts: {
      put: async () =>
        ok({ id: newId<'Artifact'>() as ArtifactId, mediaType: 'application/json', bytes: 1, summary: '' }),
      get: async () => err(NotImplementedError()),
    },
    reportUsage: () => undefined,
    reportProgress: () => undefined,
    dispatch: async () => err(NotImplementedError()),
  } as CommandToolContext;
  const firstClip = v1.kind === 'video' ? v1.items[0]!.id : '';
  return { timeline, tool, ctx, newest, slots, firstClip, deps };
}

const run = async (world: Pick<ReturnType<typeof setup>, 'tool' | 'ctx' | 'timeline'>, reasons?: unknown) =>
  world.tool.run(
    {
      projectId: world.timeline.projectId,
      timelineId: world.timeline.id,
      ...(reasons ? { reasons } : {}),
    } as never,
    world.ctx,
  );

describe('video.done', () => {
  it('is a read in the video family that never asks', () => {
    const { tool } = setup([]);
    expect(tool.name).toBe('video.done');
    expect(tool.sideEffect).toBe('read');
    expect(tool.checkpoint ?? false).toBe(false);
  });

  it("refuses while a slot fails, naming it by the template's number, and passes with a reason for it", async () => {
    const face = (world: ReturnType<typeof setup>) =>
      checkResult(
        'slotFace',
        'warn',
        {
          findings: [{ frames: { start: 0, end: 30 }, target: { kind: 'clip', id: world.firstClip } }],
          fixes: [
            agentFix('qa.fixes.matchSlotFace', {
              slot: 2,
              slotId: world.slots[0]!,
              wanted: 'hidden',
              facePct: 80,
              tools: 'timeline.slipClip',
            }),
          ],
        },
        0,
      );
    const world = setup([]);
    world.newest.qaReport!.checks.push(face(world));
    const refused = await run(world);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.detail).toContain('slot 2: slotFace');
    const passed = await run(world, [{ slot: 2, reason: 'the person wants their face here' }]);
    expect(passed.ok && passed.value).toEqual({
      renderId: world.newest.id,
      revision: world.timeline.revision,
      slots: 2,
      waived: [2],
      compared: true,
    });
  });

  it("holds the Maker's handoff to video.done: refused until a call passes, then the reasons it gave carry", async () => {
    const world = setup([], 0, createVideoDoneLedger());
    world.newest.qaReport!.checks.push(
      checkResult(
        'slotNeeds',
        'warn',
        {
          findings: [{ frames: { start: 0, end: 30 }, target: { kind: 'clip', id: world.firstClip } }],
          fixes: [
            agentFix('qa.fixes.matchSlotNeeds', {
              slot: 2,
              slotId: world.slots[0]!,
              tools: 'timeline.swapClip',
            }),
          ],
        },
        0,
      ),
    );
    const done = makerDone(world.deps);
    const handoff = { timelineId: world.timeline.id, revision: world.timeline.revision };
    const before = await done(handoff);
    expect(before.ok && before.value.passed).toBe(false);
    if (before.ok) expect(before.value.reason).toContain('Call video.done');
    expect((await run(world, [{ slot: 2, reason: 'no clip in the library shows it' }])).ok).toBe(true);
    const after = await done(handoff);
    expect(after.ok && after.value).toEqual({ passed: true });
  });

  it('refuses a draft of another revision, and passes a clean draft', async () => {
    const stale = await run(setup([checkResult('slotNeeds', 'pass', {}, 0)], 1));
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.detail).toContain('render.draft revision');
    const clean = await run(setup([checkResult('slotNeeds', 'pass', {}, 0)]));
    expect(clean.ok && clean.value).toMatchObject({ waived: [], compared: true });
  });
});
