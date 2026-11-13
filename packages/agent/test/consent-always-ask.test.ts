// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-R3: audio.cloudCritique declares `alwaysAsk`, and the plan says it always asks. Its upload shows a consent card
 * for every call, whatever standing consents exist (`vision` for frames, `vision.audio` for sound); the card offers
 * Allow once and Don't send only, and names the sound (`uploadNames`), never by a path. A `remember` sent anyway
 * stores nothing. An audio upload that doesn't ask every time keeps its own standing consent (EAR1-I5).
 */
import {
  defineTool,
  defineToolModule,
  NO_TOOL_RETRY,
  newId,
  ok,
  taalcutEventSchema,
  unwrap,
} from '@taalcut/core';
import {
  createMemoryConsentStore,
  type AgentDeps,
  type ChatHistoryEvent,
  type ConsentStore,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { collect, setup as chatSetup } from './support/chat-fixture';
import { call, harness, ofType, plan, turns } from './support/harness';
import { critique, FRAMES, SOUND_KEY, soundModule } from './support/sound-upload';

const ASK = { conversationId: 'c', message: 'Critique the sound of my film' };
const NAME = 'Voice memo 14.m4a';
const SOUND = { ...FRAMES, id: 'sound-1', module: SOUND_KEY };
const named: AgentDeps['uploadNames'] = async ({ tool }) => (tool === 'audio.cloudCritique' ? [NAME] : []);

function setup(options: { consents?: ConsentStore; alwaysAsk?: boolean; deps?: Partial<AgentDeps> } = {}) {
  const sent: string[] = [];
  const consents = options.consents ?? createMemoryConsentStore();
  const asset = newId<'Asset'>();
  const h = harness({
    script: turns(plan('Critique the sound'), critique(asset), { text: 'Done.' }),
    modules: [soundModule(sent, options.alwaysAsk === false ? { alwaysAsk: false } : {})],
    deps: { consents, cloudProviders: () => ['google'], ...options.deps },
  });
  const cards = () =>
    h.ui.flatMap((e) => (e.type === 'agent.card' && e.card.kind === 'consent' ? [e.card] : []));
  const asked = async (runId: Parameters<typeof h.events>[0]) =>
    ofType(await h.events(runId), 'approval.requested').at(-1)?.payload;
  return { ...h, sent, consents, cards, asset, asked };
}

describe('an upload that asks every time', () => {
  it('asks for every call though vision and vision.audio are always allowed, and stores no consent', async () => {
    const consents = createMemoryConsentStore();
    await consents.grant(FRAMES);
    await consents.grant(SOUND);
    const h = setup({ consents });
    for (const round of [1, 2]) {
      const paused = unwrap(await h.agent.run(ASK));
      expect(paused).toMatchObject({ status: 'paused', pending: [{ kind: 'consent' }] });
      expect(h.sent).toHaveLength(round - 1);
      const asked = await h.asked(paused.runId);
      expect(asked).toMatchObject({ kind: 'consent', reason: 'upload', alwaysAsk: true });
      expect(asked?.standingConsentIds).toBeUndefined();
      // "Always allow" sent anyway (an old client, say) is Allow once: the sound goes, nothing is remembered.
      const answer = {
        requestId: paused.pending[0]!.requestId,
        decision: 'approve' as const,
        remember: true,
      };
      expect(unwrap(await h.agent.answer(paused.runId, answer)).status).toBe('completed');
      const granted = ofType(await h.events(paused.runId), 'approval.granted').at(-1)?.payload;
      expect(granted?.consentIds).toBeUndefined();
    }
    expect(h.sent).toEqual([h.asset, h.asset]);
    expect(h.cards()).toHaveLength(2);
    expect(await consents.list()).toEqual([FRAMES, SOUND]);
  });

  it('names the sound on its card and offers Allow once and Don’t send only', async () => {
    const seen: unknown[] = [];
    const h = setup({
      deps: { uploadNames: async (request) => (seen.push(request), named(request)) },
    });
    unwrap(await h.agent.run(ASK));
    expect(seen).toEqual([{ tool: 'audio.cloudCritique', input: { assetId: h.asset } }]);
    expect(h.cards()).toMatchObject([
      {
        tool: 'audio.cloudCritique',
        upload: { modules: ['vision'], files: [NAME], sources: ['user-media'], media: 'audio' },
        options: ['allow-once', 'deny'],
      },
    ]);
    expect(h.sent).toEqual([]);
  });

  it('asks naming nothing when the name lookup fails, and never shows a path', async () => {
    const failing = setup({ deps: { uploadNames: async () => Promise.reject(new Error('library closed')) } });
    expect(unwrap(await failing.agent.run(ASK)).status).toBe('paused');
    expect(failing.cards()).toMatchObject([{ upload: { files: [] }, options: ['allow-once', 'deny'] }]);

    const pathy = setup({ deps: { uploadNames: async () => ['/Users/asha/Voice Memos/memo.m4a'] } });
    unwrap(await pathy.agent.run(ASK));
    expect(pathy.cards()[0]?.upload.files).toEqual(['memo.m4a']);
  });

  it('asks for a reference file too, which another upload would send unasked', async () => {
    const sent: string[] = [];
    const peek = defineTool({
      name: 'vision.peek',
      version: '1.0.0',
      description: 'Shows a picture to a cloud model; asks every time.',
      input: z.object({ path: z.string() }),
      output: z.object({ seen: z.boolean() }),
      costClass: 'cloud',
      sideEffect: 'external',
      alwaysAsk: true,
      timeoutMs: 5_000,
      retry: NO_TOOL_RETRY,
      permission: { network: 'internet', cloudModules: ['vision'] },
      idempotencyKey: (input) => input.path,
      estimateCost: () => ({ usd: 0.001, tokens: 100 }),
      run: async (input) => (sent.push(input.path), ok({ seen: true })),
    });
    const h = harness({
      script: turns(plan('Peek'), { toolCalls: [call('vision_peek', { path: '/scratch/exp-1/a.jpg' })] }),
      modules: [defineToolModule({ id: 'vision', tools: [peek] })],
      deps: { cloudProviders: () => ['google'], scratchRoot: '/scratch' },
    });
    const paused = unwrap(await h.agent.run(ASK));
    expect(paused.status).toBe('paused');
    const asked = ofType(await h.events(paused.runId), 'approval.requested').at(-1);
    expect(asked?.payload).toMatchObject({ reason: 'upload', upload: { sources: ['reference'] } });
    expect(asked?.payload.reference).toBeUndefined();
    expect(sent).toEqual([]);
  });
});

describe('an audio upload that does not ask every time', () => {
  it('goes without a card under its own standing consent, and asks under vision’s alone', async () => {
    const consents = createMemoryConsentStore();
    await consents.grant(FRAMES);
    const h = setup({ consents, alwaysAsk: false });
    const paused = unwrap(await h.agent.run(ASK));
    expect(h.cards()).toMatchObject([{ options: ['allow-once', 'always-allow', 'deny'] }]);
    expect((await h.asked(paused.runId))?.alwaysAsk).toBeUndefined();

    await consents.grant(SOUND);
    const next = unwrap(await h.agent.run(ASK));
    expect(next.status).toBe('completed');
    expect((await h.asked(next.runId))?.standingConsentIds).toEqual([SOUND.id]);
    expect([h.sent, h.cards().length]).toEqual([[h.asset], 1]);
  });
});

describe('the chat’s consent card for an upload that asks every time', () => {
  it('is core’s card naming the sound, with two answers, and settles without a standing consent', async () => {
    const sent: string[] = [];
    const s = chatSetup({
      modules: [soundModule(sent)],
      script: turns(plan('Critique'), critique(newId<'Asset'>()), { text: 'Heard.' }),
      deps: { cloudProviders: () => ['google'], uploadNames: named },
    });
    const signal = new AbortController().signal;
    const sentRun = unwrap(
      await s.chat.send({ conversationId: s.conversationId, text: 'critique' }, { signal }),
    );
    const events = await collect(sentRun.events);
    const consentCards = (list: readonly ChatHistoryEvent[]) =>
      list.flatMap((e) =>
        e.type === 'agent.card' && e.payload.card.type === 'consent' ? [e.payload.card] : [],
      );
    const [card] = consentCards(events);
    expect(card).toMatchObject({
      tool: 'audio.cloudCritique',
      upload: { modules: ['vision'], providers: ['google'], files: [NAME], sources: ['user-media'] },
      options: ['allow-once', 'deny'],
      status: 'pending',
    });
    for (const event of events) expect(taalcutEventSchema.safeParse(event).success, event.type).toBe(true);

    const approvalId = card!.approvalId;
    const decided = { runId: sentRun.runId, approvalId, decision: 'approve' as const, remember: true };
    unwrap(await s.chat.decideApproval(decided));
    expect(sent).toHaveLength(1);
    const history = unwrap(await s.chat.getConversation(s.conversationId)).history;
    expect(consentCards(history).map((c) => [c.status, c.options])).toEqual([
      ['pending', ['allow-once', 'deny']],
      ['approved', ['allow-once', 'deny']],
    ]);
  });
});
