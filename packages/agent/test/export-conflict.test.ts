// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2: an export refused because its timeline moved past the reviewed
 * revision (core.conflict, here from something other than the person writing
 * the timeline as the card is built) goes back through the Reviewer at the
 * timeline's head. Before, the Reviewer checked the old revision again and the
 * export was refused again, round and round with nobody asked; now a timeline
 * that keeps moving stops the run after MAX_EXPORT_RETRIES reviews, with
 * words that say why.
 */
import { unwrap, type RunId } from '@taalcut/core';
import { MAX_EXPORT_RETRIES, type AgentEvent } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { flowHarness } from './support/flow-harness';
import { flowScript } from './support/flow-script';
import { userEdit } from './support/flow-world';
import { ofType } from './support/harness';

const reel = { kind: 'link' as const, url: 'https://www.instagram.com/reel/abc123/' };
const reviews = (events: readonly AgentEvent[]) =>
  ofType(events, 'skill.entered')
    .filter((e) => e.payload.skill === 'render.reviewer')
    .map((e) => (e.payload.input as { timelineRevision?: number }).timelineRevision);
const refusals = (events: readonly AgentEvent[]) =>
  ofType(events, 'tool.failed').filter((e) => e.payload.error.code === 'core.conflict').length;

function start() {
  const h = flowHarness({ script: flowScript({ ask: false }) });
  const run = h.agent.start({
    conversationId: 'c1',
    projectId: h.world.projectId,
    message: 'Copy this reel',
    start: { path: 'reference', reference: reel },
  });
  return { h, run };
}

/** Approves each export the run asks for, up to `limit` times; the run's last outcome. */
async function approveEach(h: ReturnType<typeof flowHarness>, runId: RunId, limit = 8) {
  let outcome = unwrap(await h.agent.wait(runId));
  for (let i = 0; i < limit && outcome.status === 'paused' && outcome.pending[0]?.kind === 'tool'; i++)
    outcome = unwrap(
      await h.agent.answer(runId, { requestId: outcome.pending[0].requestId, decision: 'approve' }),
    );
  return outcome;
}

describe('an export the timeline moved under', () => {
  it('is reviewed again at the head and exports that revision', async () => {
    const { h, run } = start();
    let moved = false;
    // A write after the Editor's handoff: the card can't show revision 2, and the export of it is refused.
    h.world.beforeExportCard = () => {
      if (moved) return;
      moved = true;
      userEdit(h.world, [...h.world.timelines.keys()][0]!);
    };
    const runId = unwrap(await run);
    const outcome = await approveEach(h, runId);
    expect(outcome.status).toBe('completed');
    const events = await h.events(runId);
    expect(refusals(events)).toBe(1);
    // Before AGT2 the Reviewer checked revision 2 again, and every export after it was refused.
    expect(reviews(events)).toEqual([2, 3]);
    const timelineId = [...h.world.timelines.keys()][0]!;
    expect(h.world.exported).toEqual([{ timelineId, revision: 3 }]);
  });

  it(`stops after ${MAX_EXPORT_RETRIES} reviews more when it keeps moving, and says why`, async () => {
    const { h, run } = start();
    h.world.beforeExport = async () => void userEdit(h.world, [...h.world.timelines.keys()][0]!);
    const runId = unwrap(await run);
    const outcome = await approveEach(h, runId);
    expect(outcome.status).toBe('failed');
    const events = await h.events(runId);
    expect(refusals(events)).toBe(MAX_EXPORT_RETRIES + 1);
    expect(reviews(events)).toEqual([2, 3, 4]);
    expect(ofType(events, 'run.failed').map((e) => e.payload.error.code)).toEqual([
      'agent.export_kept_changing',
    ]);
    expect(h.world.exported).toEqual([]);
  });
});
