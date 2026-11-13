// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The QA loop (SPEC sections 12 and 13): a failing review sends its fixes
 * back to the Editor and reviews again; after two fix rounds that still
 * fail, the export is skipped and the QA card says what is left, with no
 * export card. The Reviewer's handoff is read in either shape (passed and
 * fixes, or the render lane's next and editorSteps).
 */
import { unwrap } from '@taalcut/core';
import { MAX_FIX_LOOPS, reviewOutcome, type AgentEvent } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { flowHarness } from './support/flow-harness';
import { flowScript } from './support/flow-script';
import { createWorld } from './support/flow-world';
import { ofType } from './support/harness';

const start = {
  path: 'reference' as const,
  reference: { kind: 'link' as const, url: 'https://youtube.com/shorts/abc' },
};
const entered = (events: readonly AgentEvent[]) =>
  ofType(events, 'skill.entered').map((e) => e.payload.skill.split('.')[1]);

async function runWith(qa: boolean[]) {
  const h = flowHarness({ world: createWorld({ qa }), script: flowScript({ ask: false }) });
  const outcome = unwrap(
    await h.agent.run({ conversationId: 'c', projectId: h.world.projectId, message: 'Copy', start }),
  );
  return { h, outcome, events: await h.events(outcome.runId) };
}

describe('the Reviewer and the fix loop', () => {
  it('a failed review goes back to the Editor with its fixes, and the next review passes', async () => {
    const { outcome, events } = await runWith([false, true]);
    expect(outcome).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });
    expect(entered(events)).toEqual(['analyst', 'librarian', 'editor', 'reviewer', 'editor', 'reviewer']);
    const fix = ofType(events, 'skill.entered')[4]!.payload;
    expect(fix.input).toMatchObject({ fixes: [{ checkId: 'blackFrames', action: 'swap' }] });
    const fixPlan = ofType(events, 'plan.updated')[0]!.payload.steps;
    expect(fixPlan.map((s) => [s.flow?.key, s.flow?.fixes?.length])).toEqual([
      ['editor', 1],
      ['reviewer', undefined],
    ]);
    const qa = ofType(events, 'card.sent').filter((e) => e.payload.card.type === 'qaReport');
    // One QA card for the step, sent again when the next round passed.
    expect(new Set(qa.map((e) => e.payload.card.id)).size).toBe(1);
    expect(ofType(events, 'card.sent').at(-1)?.payload.card.type).toBe('exportApproval');
  });

  it(`after ${MAX_FIX_LOOPS} fix rounds that still fail, the export is skipped and no export card is sent`, async () => {
    const { h, outcome, events } = await runWith([false, false, false, false]);
    expect(outcome.status).toBe('completed');
    expect(entered(events).filter((s) => s === 'reviewer')).toHaveLength(1 + MAX_FIX_LOOPS);
    expect(ofType(events, 'step.skipped').map((e) => e.payload.reason)).toEqual(['qa-failed']);
    const sent = ofType(events, 'card.sent').map((e) => e.payload.card);
    expect(sent.some((c) => c.type === 'exportApproval')).toBe(false);
    expect(sent.filter((c) => c.type === 'qaReport').at(-1)).toMatchObject({
      summary: { verdict: 'needsAttention', failing: ['blackFrames'] },
    });
    expect(h.world.exported).toEqual([]);
    // No opening choices: nothing was exported.
    expect(sent.some((c) => c.type === 'openingChoices')).toBe(false);
  });

  it("reads the render lane's Reviewer handoff as well as the stand-in's", () => {
    expect(reviewOutcome({ passed: true, fixes: [] })).toBe('passed');
    expect(reviewOutcome({ passed: false, fixes: [{}] })).toBe('fix');
    expect(reviewOutcome({ verdict: 'passed', next: 'user' })).toBe('user');
    expect(reviewOutcome({ verdict: 'needsAttention', next: 'editor', editorSteps: [{}] })).toBe('fix');
    expect(reviewOutcome({ next: 'reexport' })).toBe('fix');
    expect(reviewOutcome({})).toBe('passed');
  });
});
