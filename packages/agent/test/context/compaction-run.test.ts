// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT1, compaction in a run: a flow whose prompts outgrow a small window logs context.compacted before the call it
 * condensed, the model is sent the condensed prompt, and replay condenses it again the same way (no prompt drift).
 */
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { estimateTokens, promptBudget } from '../../src/context/compaction';
import { flowHarness } from '../support/flow-harness';
import { flowScript } from '../support/flow-script';
import { ofType } from '../support/harness';

const reel = { kind: 'link' as const, url: 'https://www.instagram.com/reel/EXAMPLE123/' };

async function makeRun(window: number | undefined) {
  const h = flowHarness({
    script: flowScript({ ask: false }),
    ...(window ? { deps: { contextWindow: () => window } } : {}),
  });
  const runId = unwrap(
    await h.agent.start({
      conversationId: 'c',
      projectId: h.world.projectId,
      message: 'Copy this reel',
      start: { path: 'reference', reference: reel },
    }),
  );
  await h.agent.wait(runId);
  return { h, runId, events: await h.events(runId) };
}

describe('compaction in a run', () => {
  it('condenses only past the budget, logs it, and replays it exactly', async () => {
    const roomy = await makeRun(1_000_000);
    expect(ofType(roomy.events, 'context.compacted')).toEqual([]);
    // The largest prompt of the flow, estimated: a window that leaves less than that for it.
    const largest = Math.max(
      ...roomy.h.models.requests.map((r) => estimateTokens(r.system ?? '', r.tools ?? [], r.messages)),
    );
    const window = Math.ceil((largest * 0.8 + 4_096) / 0.9);
    const tight = await makeRun(window);
    const compacted = ofType(tight.events, 'context.compacted');
    expect(compacted.length).toBeGreaterThan(0);
    const budget = promptBudget(window);
    for (const event of compacted) {
      expect(event.payload).toMatchObject({ window, budgetTokens: budget });
      expect(event.payload.afterTokens).toBeLessThan(event.payload.beforeTokens);
      // A required prompt that still cannot fit ends here, rather than making a one-token call.
      const next = tight.events[tight.events.indexOf(event) + 1];
      expect(next).toMatchObject(
        event.payload.fits
          ? { type: 'model.requested', payload: { modelCallId: event.payload.modelCallId } }
          : { type: 'run.failed', payload: { error: { code: 'models.context_too_long' } } },
      );
    }
    const sent = tight.h.models.requests.map((r) =>
      estimateTokens(r.system ?? '', r.tools ?? [], r.messages),
    );
    expect(Math.max(...sent)).toBeLessThan(largest);
    const replayed = unwrap(await tight.h.agent.replay(tight.runId));
    expect(replayed.promptDrift).toBe(0);
  });
});
