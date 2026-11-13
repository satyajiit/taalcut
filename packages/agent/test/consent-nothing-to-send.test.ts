// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A call that can't send anything asks no consent (packages/agent/src/consent.ts). At BRK1's gate a small local model
 * mistyped a frame's path, so the frame wasn't in the scratch folder: the card asked about a file that didn't exist,
 * on a profile with no cloud model to send it to. Each is still an approval logged for its call.
 */
import { unwrap } from '@taalcut/core';
import { createMemoryConsentStore } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { cloudVisionModule } from './support/fixtures';
import { call, harness, ofType, plan, turns } from './support/harness';

const ASK = { conversationId: 'c', message: 'What is in this frame?' };

function describing(path: string, deps: { providers?: string[]; there?: readonly string[] }) {
  const there = new Set(deps.there ?? []);
  const h = harness({
    script: turns(
      plan('Describe'),
      { toolCalls: [call('vision_describeFrame', { path, atSeconds: 0 })] },
      { text: 'Done.' },
    ),
    modules: [cloudVisionModule()],
    deps: {
      consents: createMemoryConsentStore(),
      cloudProviders: () => deps.providers ?? ['google'],
      scratchRoot: '/appData/scratch',
      fileExists: async (file) => there.has(file),
    },
  });
  const cards = () => h.ui.filter((e) => e.type === 'agent.card' && e.card.kind === 'consent');
  return { ...h, cards };
}

describe('consent for a call that sends nothing', () => {
  it('asks nothing for a file that is not there, and logs why', async () => {
    const h = describing('/appData/scrach/exp-1/strip-000282.jpg', {});
    const done = unwrap(await h.agent.run(ASK));
    expect(done.status).toBe('completed');
    expect(h.cards()).toEqual([]);
    const events = await h.events(done.runId);
    const requested = ofType(events, 'approval.requested').map((e) => e.payload);
    expect(requested).toEqual([
      expect.objectContaining({
        kind: 'consent',
        reason: 'missing-file',
        missingFiles: ['/appData/scrach/exp-1/strip-000282.jpg'],
      }),
    ]);
    expect(ofType(events, 'approval.granted').map((e) => e.payload.requestId)).toEqual([
      requested[0]!.requestId,
    ]);
  });

  it.each([
    ['a file that is there', '/Trip/a.jpg', ['/Trip/a.jpg']],
    ['a relative path, which a tool may find elsewhere', 'Trip/a.jpg', []],
  ])('still asks for %s', async (_, path, there) => {
    const h = describing(path, { there });
    const paused = unwrap(await h.agent.run(ASK));
    expect(paused).toMatchObject({ status: 'paused', pending: [{ kind: 'consent' }] });
    expect(h.cards()).toHaveLength(1);
  });

  it("asks nothing when the module's chain has no cloud model now", async () => {
    const h = describing('/Trip/a.jpg', { providers: [], there: ['/Trip/a.jpg'] });
    const done = unwrap(await h.agent.run(ASK));
    expect(done.status).toBe('completed');
    expect(h.cards()).toEqual([]);
    const requested = ofType(await h.events(done.runId), 'approval.requested').map((e) => e.payload);
    expect(requested).toEqual([expect.objectContaining({ reason: 'on-device', localOnly: true })]);
  });
});
