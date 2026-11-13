// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1: a tool whose stills show the person's video to the run's model (workspace.renderOver) is an upload. In a run
 * whose chain is in the cloud and sees images, the first call asks with the consent card, and a standing consent for
 * the agent module covers the rest, each logged. Its stills over grey (workspace.render) ask nothing. A chain on this
 * Mac, or one where no model sees images, sends nothing of the person's, so the call is answered at once and logged.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { artifactRefSchema, defineTool, defineToolModule, NO_TOOL_RETRY, ok, unwrap, type ArtifactRef } from '@taalcut/core';
import { createMemoryConsentStore } from '@taalcut/agent';
import { call, harness, ofType, plan, turns } from '../support/harness';

const stills = z.object({ frames: z.array(artifactRefSchema) });

function stillTool(name: string, over: 'grey' | 'footage') {
  return defineTool({
    name,
    version: '1.0.0',
    description: `Draws stills of a composition over ${over}.`,
    input: z.object({ entry: z.string() }),
    output: stills,
    costClass: 'local',
    sideEffect: over === 'grey' ? 'read' : 'external',
    timeoutMs: 20_000,
    retry: NO_TOOL_RETRY,
    permission:
      over === 'grey'
        ? { network: 'none' }
        : { network: 'internet', cloudModules: ['agent'], uploads: { what: 'user-media', consent: 'first-use' } },
    idempotencyKey: (input) => `${name}:${input.entry}`,
    images: (output) => output.frames as ArtifactRef[],
    run: async (_input, ctx) => {
      const still = await ctx.artifacts.put({ mediaType: 'image/jpeg', data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), summary: 'A still.' });
      return still.ok ? ok({ frames: [still.value] }) : still;
    },
  });
}

const workspace = defineToolModule({
  id: 'workspace',
  tools: [stillTool('workspace.render', 'grey'), stillTool('workspace.renderOver', 'footage')],
});

function rendering(
  tool: string,
  deps: { readonly providers?: readonly string[]; readonly sees?: boolean; readonly standing?: readonly string[] } = {},
) {
  const consents = createMemoryConsentStore();
  const h = harness({
    script: turns(plan('Design'), { toolCalls: [call(tool.replace('.', '_'), { entry: 'bubble/index.html' })] }, { text: 'Done.' }),
    modules: [workspace],
    deps: {
      consents,
      cloudProviders: () => [...(deps.providers ?? ['openai'])],
      seesImages: () => deps.sees ?? true,
    },
  });
  const cards = () => h.ui.filter((e) => e.type === 'agent.card' && e.card.kind === 'consent');
  const requested = async (runId: Parameters<typeof h.events>[0]) =>
    ofType(await h.events(runId), 'approval.requested').map((e) => e.payload);
  const grant = () =>
    deps.standing ? consents.grant({ id: 'standing-1', module: 'agent', providers: [...deps.standing], grantedAt: 1 }) : Promise.resolve();
  return { ...h, cards, requested, grant };
}

const ASK = { conversationId: 'c', message: 'Make the bubble pop more.' };

describe('the stills of the person’s video and upload consent', () => {
  it('asks the first time it shows their footage to a cloud model that sees images, and never over grey', async () => {
    const over = rendering('workspace.renderOver');
    const paused = unwrap(await over.agent.run(ASK));
    expect(paused).toMatchObject({ status: 'paused', pending: [{ kind: 'consent' }] });
    expect(over.cards()).toHaveLength(1);
    expect(over.cards()[0]).toMatchObject({ card: { tool: 'workspace.renderOver', upload: { modules: ['agent'], providers: ['openai'] } } });

    const grey = rendering('workspace.render');
    const done = unwrap(await grey.agent.run(ASK));
    expect(done.status).toBe('completed');
    expect(grey.cards()).toEqual([]);
    expect(await grey.requested(done.runId)).toEqual([]);
  });

  it('runs under a standing consent for the agent module, logged as an approval', async () => {
    const h = rendering('workspace.renderOver', { standing: ['openai'] });
    await h.grant();
    const done = unwrap(await h.agent.run(ASK));
    expect(done.status).toBe('completed');
    expect(h.cards()).toEqual([]);
    expect(await h.requested(done.runId)).toEqual([
      expect.objectContaining({ kind: 'consent', reason: 'standing-consent', standingConsentIds: ['standing-1'] }),
    ]);
  });

  it.each([
    ['a chain on this Mac', { providers: [] }, 'on-device'],
    ['a chain where no model sees images', { sees: false }, 'no-pictures'],
  ] as const)('asks nothing on %s: nothing of the person’s leaves', async (_, deps, reason) => {
    const h = rendering('workspace.renderOver', { ...deps });
    const done = unwrap(await h.agent.run(ASK));
    expect(done.status).toBe('completed');
    expect(h.cards()).toEqual([]);
    expect(await h.requested(done.runId)).toEqual([expect.objectContaining({ kind: 'consent', reason, localOnly: true })]);
  });
});
