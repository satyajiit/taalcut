// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The flow's Reviewer (agent SPEC 12): registrable, reads the draft's stored
 * QA report as its second method, and shows the draft's QA report card.
 */
import { describe, expect, it } from 'vitest';
import {
  CAPTION_COMMANDS,
  newId,
  parseCard,
  skillModuleProblems,
  skillSpecProblems,
  unwrap,
  type QaFix,
  type SkillContext,
} from '@taalcut/core';
import { autoFix, checkResult } from '../../src/qa/result';
import { summarize } from '../../src/qa/verdict';
import { createRenderSkillModule, reviewerSkill } from '../../src/skills/reviewer';
import type { DraftReview } from '../../src/skills/review-checks';
import { renderRecord } from '../router/fixtures';
import { memoryRenderStore } from '../support/render-store';
import { makeTimeline } from '../support/timeline';
import { report, target } from './support';

const moveCaptions: QaFix = {
  kind: 'command',
  labelKey: 'qa.fixes.moveCaptions',
  command: CAPTION_COMMANDS.setStyle,
  payload: { ...target, style: { anchorY: 0.6 } },
};

function world() {
  const timeline = makeTimeline({ items: [{ frames: 90 }, { frames: 60 }] });
  const store = memoryRenderStore();
  const skill = reviewerSkill({ store });
  const ctx: SkillContext = {
    runId: newId<'AgentRun'>() as never,
    projectId: timeline.projectId,
    flowId: newId<'Flow'>() as never,
    stepId: 'f4',
    signal: new AbortController().signal,
  };
  const draft = (status: 'pass' | 'fail' | 'warn', revision = timeline.revision) => {
    const fixes = status === 'fail' ? [moveCaptions] : [];
    const checks = [
      checkResult('captionSafeZone', status, { fixes }, 0),
      checkResult('loudness', 'pass', { fixes: [autoFix('renormaliseAudio')] }, 0),
    ];
    const qaReport = report(checks);
    const record = renderRecord(timeline, {
      timelineRevision: revision,
      status: status === 'fail' ? 'needsAttention' : 'ready',
      qaReport: { ...qaReport },
      qa: summarize(qaReport),
    });
    store.records.set(record.id, record);
    return record;
  };
  const handoff = (renderId: string, overrides: Partial<DraftReview> = {}): DraftReview => ({
    renderId: renderId as DraftReview['renderId'],
    timelineVersion: timeline.revision,
    passed: true,
    fixes: [],
    ...overrides,
  });
  return { timeline, store, skill, ctx, draft, handoff };
}

describe('reviewer skill (draft before the approval)', () => {
  it('meets the skill contract and registers as the render module', () => {
    const { skill, store } = world();
    expect(skillSpecProblems(skill)).toEqual([]);
    expect(skillModuleProblems(createRenderSkillModule({ store }))).toEqual([]);
    expect(skill.tools.names).toEqual(['render.draft', 'render.getQaReport', 'timeline.captureFrame']);
  });

  it('takes the flow facts as input and refers to the draft', () => {
    const { skill, timeline } = world();
    const input = skill.input.parse({
      projectId: timeline.projectId,
      timelineId: timeline.id,
      version: 3,
      revision: 3,
      timelineRevision: 3,
    });
    expect(input).toEqual({ projectId: timeline.projectId, timelineId: timeline.id, version: 3 });
    const renderId = newId<'Render'>();
    expect(skill.refs(skill.output.parse({ renderId, timelineVersion: 3, passed: true, fixes: [] }))).toEqual(
      [{ entity: 'render', id: renderId, version: 1 }],
    );
  });

  it('passes a handoff that says what the draft report says', async () => {
    const { skill, ctx, draft, handoff } = world();
    const passed = draft('warn');
    expect(unwrap(await skill.verify!(handoff(passed.id), ctx))).toEqual({ verdict: 'pass' });
    const failed = draft('fail');
    const fixed = handoff(failed.id, { passed: false, fixes: [moveCaptions] });
    expect(unwrap(await skill.verify!(fixed, ctx))).toEqual({ verdict: 'pass' });
  });

  it('retries a handoff that disagrees with the report or the version', async () => {
    const { skill, ctx, draft, handoff, timeline } = world();
    const failed = draft('fail');
    const claimsPass = unwrap(await skill.verify!(handoff(failed.id), ctx));
    expect(claimsPass).toMatchObject({ verdict: 'retry', reason: expect.stringContaining('needsAttention') });
    const noFixes = unwrap(await skill.verify!(handoff(failed.id, { passed: false }), ctx));
    expect(noFixes).toMatchObject({ verdict: 'retry', reason: expect.stringContaining('at least one fix') });
    const older = draft('pass', timeline.revision + 1);
    const wrongVersion = unwrap(await skill.verify!(handoff(older.id), ctx));
    expect(wrongVersion).toMatchObject({ verdict: 'retry', reason: expect.stringContaining('render.draft') });
    const missing = unwrap(await skill.verify!(handoff(newId<'Render'>()), ctx));
    expect(missing.verdict).toBe('retry');
  });

  it('retries auto fixes and fixes edited out of shape', async () => {
    const { skill, ctx, draft, handoff } = world();
    const failed = draft('fail');
    const auto = handoff(failed.id, { passed: false, fixes: [autoFix('rerender')] });
    expect(unwrap(await skill.verify!(auto, ctx)).verdict).toBe('retry');
    const edited: QaFix = { ...moveCaptions, payload: { style: { anchorY: 'low' } } };
    expect(
      unwrap(await skill.verify!(handoff(failed.id, { passed: false, fixes: [edited] }), ctx)).verdict,
    ).toBe('retry');
  });

  it("retries a render with no QA report and another project's render", async () => {
    const { skill, ctx, handoff, timeline, store } = world();
    const record = renderRecord(timeline, { status: 'rendering', qaReport: null, qa: null });
    store.records.set(record.id, record);
    expect(unwrap(await skill.verify!(handoff(record.id), ctx))).toMatchObject({
      verdict: 'retry',
      reason: expect.stringContaining('no QA report'),
    });
    const other = { ...ctx, projectId: newId<'Project'>() as never };
    expect(unwrap(await skill.verify!(handoff(record.id), other)).verdict).toBe('retry');
  });

  it("shows the draft's QA report as the step's card", async () => {
    const { skill, ctx, draft, handoff } = world();
    const failed = draft('fail');
    const card = unwrap(
      await skill.card!(handoff(failed.id, { passed: false, fixes: [moveCaptions] }), ctx),
    )!;
    expect(parseCard(card).ok).toBe(true);
    expect(card).toMatchObject({
      type: 'qaReport',
      id: `step:${ctx.flowId}:render.reviewer`,
      renderId: failed.id,
      summary: { verdict: 'needsAttention', failing: ['captionSafeZone'] },
    });
    expect((card as { checks: { id: string }[] }).checks[0]?.id).toBe('captionSafeZone');
  });
});
