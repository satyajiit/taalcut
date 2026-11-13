// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-MAKE, found on the owner's path: the local Librarian planned its own work with updatePlan ("Ask the user how
 * many variants", "Cast the library…"). Those steps went to the end of the run's plan, so they ran again after the
 * flow had ended, and the run failed with models.context_too_long after its QA card. A skill step's list is now its
 * own: updatePlan answers with a note and the run's plan keeps only the flow's steps.
 */
import type { ModelScript } from '@taalcut/agent';
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { flowHarness } from './support/flow-harness';
import { flowScript } from './support/flow-script';
import { call, ofType } from './support/harness';

const reel = { kind: 'link' as const, url: 'https://www.instagram.com/reel/EXAMPLE123/' };
const STEP_LIST = [{ text: 'Check the slots again.' }, { text: 'Ask the user how many variants they want.' }];

/** The flow's script, with an Editor that also plans its own steps on its first turn. */
const editorPlans: ModelScript = (request, turn) => {
  const reply = flowScript({ ask: false })(request, turn);
  const editor = /# Skill: timeline\.editor\b/.test(request.system ?? '');
  const first = !request.messages.some(
    (m) => m.role === 'tool' && JSON.stringify(m).includes('own checklist'),
  );
  if (!editor || !first || !reply.toolCalls) return reply;
  return { ...reply, toolCalls: [call('updatePlan', { steps: STEP_LIST }), ...reply.toolCalls] };
};

describe("a skill step's own plan (BRK1-MAKE)", () => {
  it('stays in the step: the run plans no extra steps and ends with the flow', async () => {
    const h = flowHarness({ script: editorPlans, settings: { autonomy: 'autopilot' } });
    const runId = unwrap(
      await h.agent.start({
        conversationId: 'c',
        projectId: h.world.projectId,
        message: 'Copy this reel',
        start: { path: 'reference', reference: reel },
      }),
    );
    const outcome = unwrap(await h.agent.wait(runId));
    expect(outcome.status).toBe('completed');
    const events = await h.events(runId);
    const planned = ofType(events, 'tool.completed').find((e) =>
      JSON.stringify(e.payload.output).includes('own checklist'),
    );
    expect(planned).toBeDefined();
    // Before: both steps were appended after the export and ran once the flow had ended.
    const texts = ofType(events, 'step.started').map((e) => e.payload.text);
    expect(texts).not.toContain('Check the slots again.');
    expect(texts).not.toContain('Ask the user how many variants they want.');
    expect(ofType(events, 'plan.updated').flatMap((e) => e.payload.steps.map((s) => s.text))).not.toContain(
      'Check the slots again.',
    );
  });
});
