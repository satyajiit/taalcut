// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-RUN: the make flow runs the Librarian once. In the owner's run, answering the variants question rechecked
 * the flow's refs; the template the Analyst had handed off had a newer version (the flow's own work, no person
 * touched it), so the recheck logged it as the person's change. When the Librarian finished, the flow ran it
 * again (f6, variants 1) and the gaps step twice: the second Librarian's assemble hit core.conflict on the
 * timeline the first gaps step had edited. Now only a person's command, or an export card gone stale, says the
 * person changed something: the flow is Analyst → Librarian → gaps → Editor → Reviewer, each once.
 */
import { unwrap, type RunId } from '@taalcut/core';
import type { AgentEvent } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { ofType } from '../support/harness';
import { gapHarness, takeGapDefaults } from './gap-harness';
import { gapFlowScript } from './gap-script';

const reel = { kind: 'link' as const, url: 'https://www.instagram.com/reel/EXAMPLE123/' };

const skillsEntered = (events: readonly AgentEvent[]) =>
  ofType(events, 'skill.entered').map((e) => e.payload.skill);

async function asked(h: ReturnType<typeof gapHarness>, runId: RunId) {
  const outcome = unwrap(await h.agent.wait(runId));
  expect(outcome).toMatchObject({ status: 'paused', pending: [{ kind: 'question' }] });
  return outcome.pending[0]!.requestId;
}

describe('the make flow runs each step once (FIX-RUN)', () => {
  it('a newer template version the flow made is no change of the person: Librarian, gaps, then the Editor', async () => {
    const h = gapHarness({ plan: ['ok', 'ok', 'empty', 'empty'], script: gapFlowScript() });
    const runId = unwrap(
      await h.agent.start({
        conversationId: 'c1',
        projectId: h.world.projectId,
        message: 'Copy this reel',
        start: { path: 'reference', reference: reel },
      }),
    );
    const requestId = await asked(h, runId);
    // The flow's own write: the template moved past the version the Analyst handed off, with no command of a person.
    const templateId = [...h.world.templates.keys()][0]!;
    h.world.templates.set(templateId, (h.world.templates.get(templateId) ?? 1) + 1);

    unwrap(
      await h.agent.answer(runId, { requestId, decision: 'approve', answer: { kind: 'variants', count: 1 } }),
    );
    // FIX-ASK: the two shots with no clip ask before render too; the person takes the card's fixes.
    const outcome = await takeGapDefaults(h, runId);
    expect(outcome).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });
    const events = await h.events(runId);
    expect(ofType(events, 'flow.inputChanged')).toEqual([]);
    expect(skillsEntered(events)).toEqual([
      'templates.analyst',
      'timeline.librarian',
      'agent.gaps',
      'timeline.editor',
      'render.reviewer',
    ]);
    // The variants answer came before the one cast; nothing was cast again over the timeline the gaps step edited.
    const tools = ofType(events, 'tool.requested').map((e) => e.payload.tool);
    expect(tools.filter((t) => t === 'timeline.cast')).toHaveLength(1);
    const asking = events.findIndex((e) => e.type === 'approval.requested' && e.payload.kind === 'question');
    const casting = events.findIndex(
      (e) => e.type === 'tool.requested' && e.payload.tool === 'timeline.cast',
    );
    expect(asking).toBeGreaterThanOrEqual(0);
    expect(casting).toBeGreaterThan(asking);
    expect(ofType(events, 'tool.failed').map((e) => e.payload.error.code)).not.toContain('core.conflict');
  });
});
