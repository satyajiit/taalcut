// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * render.draft (P2-M8): the Reviewer's QA-checked draft runs without asking,
 * follows its job, says whether QA passed, and the approved render.export of
 * the same revision returns the same render without a second job.
 */
import { describe, expect, it } from 'vitest';
import {
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  err,
  newId,
  NotImplementedError,
  ok,
  parseCard,
  unwrap,
  type ArtifactId,
  type CommandToolContext,
  type JobRunner,
  type QaCheckResult,
  type RenderId,
} from '@taalcut/core';
import { createRenderCommands } from '../../src/commands/render-commands';
import { checkResult } from '../../src/qa/result';
import { summarize } from '../../src/qa/verdict';
import { renderToolModule } from '../../src/tools/render-tools';
import { AGENT, memoryTimelines, recordingEnqueuer } from '../commands/support';
import { report } from '../qa/support';
import { memoryRenderStore } from '../support/render-store';
import { makeTimeline } from '../support/timeline';

/** The agent's rule at "Only before render" (agent SPEC 7): destructive, external and checkpoint tools ask. */
const needsApprovalAtBeforeRender = (tool: { sideEffect: string; checkpoint?: boolean }) =>
  tool.sideEffect === 'destructive' || tool.sideEffect === 'external' || tool.checkpoint === true;

function setup(checks: readonly QaCheckResult[]) {
  const timeline = makeTimeline({ items: [{ frames: 90 }] });
  const store = memoryRenderStore();
  const settings = createMemorySettingsStore();
  const timelines = memoryTimelines(timeline);
  const clock = createManualClock(1_000);
  const enqueuer = recordingEnqueuer();
  const commands = createRenderCommands({ store, enqueuer, timelines, settings, clock });
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
  bus.register(...commands.all);
  const runs: unknown[] = [];
  const jobs: JobRunner = {
    async run(_kind, input) {
      runs.push(input);
      const { renderId } = input as { renderId: RenderId };
      const qaReport = report(checks, { renderId });
      const passed = qaReport.verdict !== 'needsAttention';
      await store.update(renderId, {
        status: passed ? 'ready' : 'needsAttention',
        qaReport,
        qa: summarize(qaReport),
      });
      return ok({ renderId, status: passed ? 'ready' : 'needsAttention', qa: null } as never);
    },
  };
  const module = renderToolModule({ store, timelines, settings, jobs });
  const tool = (name: string) => module.tools.find((candidate) => candidate.name === name)!;
  const ctx = (): CommandToolContext => ({
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    runId: newId<'AgentRun'>(),
    attempt: 1,
    artifacts: {
      put: async (input) =>
        ok({
          id: newId<'Artifact'>() as ArtifactId,
          mediaType: input.mediaType,
          bytes: 1,
          summary: input.summary,
        }),
      get: async () => err(NotImplementedError()),
    },
    reportUsage: () => undefined,
    reportProgress: () => undefined,
    dispatch: async (payload) => {
      const receipt = await bus.dispatch('render.export', payload, AGENT);
      return receipt.ok ? ok(receipt.value.result) : receipt;
    },
  });
  return { timeline, store, tool, runs, ctx, enqueuer };
}

const input = (timeline: { projectId: string; id: string; revision: number }) => ({
  projectId: timeline.projectId,
  timelineId: timeline.id,
  revision: timeline.revision,
});

describe('render.draft', () => {
  it('is a write that is not a checkpoint, so it runs without asking before render', () => {
    const { tool } = setup([]);
    const draft = tool('render.draft');
    expect(draft.sideEffect).toBe('write');
    expect(draft.checkpoint ?? false).toBe(false);
    expect(draft.approvalCard).toBeUndefined();
    expect(needsApprovalAtBeforeRender(draft)).toBe(false);
  });

  it('renders the revision with the export settings and says QA passed', async () => {
    const { timeline, tool, runs, ctx } = setup([checkResult('loudness', 'warn', {}, 0)]);
    const output = unwrap(await tool('render.draft').run(input(timeline), ctx())) as {
      render: { id: string; status: string; timelineRevision: number; presetId: string };
      passed: boolean;
      timelineRevision: number;
      failing: unknown[];
    };
    expect(output).toMatchObject({ passed: true, timelineRevision: timeline.revision, failing: [] });
    expect(output.render).toMatchObject({ status: 'ready', presetId: 'device' });
    expect(runs).toHaveLength(1);
    const card = unwrap(
      await tool('render.draft').resultCard!(output as never, {
        runId: newId<'AgentRun'>(),
        toolCallId: newId<'ToolRun'>(),
        projectId: timeline.projectId as never,
        signal: new AbortController().signal,
      }),
    );
    expect(card && parseCard(card).ok).toBe(true);
  });

  it("lists the slots a draft misses against its template apart from QA's failures (AGT2-MATCH)", async () => {
    const fix = {
      kind: 'agent' as const,
      instructionKey: 'qa.fixes.matchSlotNeeds',
      params: { slot: 1, slotId: 's1', need: 'a made-up need', tools: 'timeline.swapClip' },
    };
    const finding = { frames: { start: 0, end: 30 }, target: { kind: 'clip' as const, id: 'c1' } };
    const { timeline, tool, ctx } = setup([
      checkResult('slotNeeds', 'warn', { findings: [finding], fixes: [fix] }, 0),
      checkResult('slotFace', 'pass', {}, 0),
    ]);
    const output = unwrap(await tool('render.draft').run(input(timeline), ctx())) as {
      passed: boolean;
      failing: unknown[];
      slotMatch: unknown[];
    };
    // A likeness miss warns: the draft passes QA, and the Maker reads what differs in slotMatch.
    expect(output).toMatchObject({
      passed: true,
      failing: [],
      slotMatch: [{ id: 'slotNeeds', slots: 1, fixes: [fix] }],
    });
  });

  it('says a failing draft did not pass, with its failing checks and fixes', async () => {
    const fix = {
      kind: 'agent' as const,
      instructionKey: 'qa.fixes.swapOrTrimDark',
      params: { clipId: 'c1' },
    };
    const { timeline, tool, ctx } = setup([checkResult('blackFrames', 'fail', { fixes: [fix] }, 0)]);
    const output = unwrap(await tool('render.draft').run(input(timeline), ctx())) as {
      passed: boolean;
      failing: { id: string; fixes: unknown[] }[];
    };
    expect(output.passed).toBe(false);
    expect(output.failing).toEqual([{ id: 'blackFrames', fixes: [fix] }]);
  });

  it('is the render the approved export delivers: no second render of the same revision', async () => {
    const { timeline, tool, runs, ctx, enqueuer, store } = setup([]);
    const draft = unwrap(await tool('render.draft').run(input(timeline), ctx())) as {
      render: { id: string };
    };
    const exported = unwrap(
      await tool('render.export').run(
        { projectId: timeline.projectId, timelineId: timeline.id, notify: true },
        ctx(),
      ),
    ) as { render: { id: string; status: string; notify: boolean } };
    expect(exported.render).toMatchObject({ id: draft.render.id, status: 'ready', notify: true });
    expect(runs).toHaveLength(1);
    expect(enqueuer.requests.filter((request) => request.kind === 'render.export')).toHaveLength(1);
    expect(store.records.size).toBe(1);
  });

  it('refuses a revision that is no longer the timeline’s', async () => {
    const { timeline, tool, ctx } = setup([]);
    const stale = await tool('render.draft').run(
      { ...input(timeline), revision: timeline.revision + 1 },
      ctx(),
    );
    expect(stale.ok ? null : stale.error.code).toBe('core.conflict');
  });
});
