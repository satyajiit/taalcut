// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-I5: a standing consent covers one module and one kind of media. audio.cloudCritique sends the person's sound
 * through `vision`, whose "Always allow" they may have given for frames: its upload still asks with its own card.
 * An "Always allow" given for sound lets later audio uploads go without one, but only for a tool that doesn't ask
 * every time: the real tool does (EAR1-R3, consent-always-ask.test.ts). Local only still sends nothing.
 */
import { newId, unwrap } from '@taalcut/core';
import { consentsService, createMemoryConsentStore, type ConsentStore } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { cloudVisionModule } from './support/fixtures';
import { call, harness, ofType, plan, turns } from './support/harness';
import { critique, FRAMES, SOUND_KEY, soundModule } from './support/sound-upload';

const ASK = { conversationId: 'c', message: 'Critique the sound of my film' };

function setup(options: { consents?: ConsentStore; frameFirst?: boolean; alwaysAsk?: boolean } = {}) {
  const sent: string[] = [];
  const frames: string[] = [];
  const consents = options.consents ?? createMemoryConsentStore();
  const asset = newId<'Asset'>();
  const steps = options.frameFirst
    ? [{ toolCalls: [call('vision_describeFrame', { path: '/Trip/a.mov', atSeconds: 1 })] }, critique(asset)]
    : [critique(asset)];
  const h = harness({
    script: turns(plan('Critique the sound'), ...steps, { text: 'Done.' }),
    modules: [
      cloudVisionModule({ uploads: frames }),
      soundModule(sent, options.alwaysAsk === undefined ? {} : { alwaysAsk: options.alwaysAsk }),
    ],
    deps: { consents, cloudProviders: () => ['google'] },
  });
  const cards = () =>
    h.ui.flatMap((e) => (e.type === 'agent.card' && e.card.kind === 'consent' ? [e.card] : []));
  return { ...h, sent, frames, consents, cards, asset };
}

describe('sound uploads ask for their own consent', () => {
  it("asks for sound though vision's frames are always allowed, and Don't send sends nothing", async () => {
    const h = setup({ frameFirst: true });
    const first = unwrap(await h.agent.run(ASK));
    expect(h.cards().map((card) => card.tool)).toEqual(['vision.describeFrame']);
    const always = { requestId: first.pending[0]!.requestId, decision: 'approve' as const, remember: true };
    const paused = unwrap(await h.agent.answer(first.runId, always));
    expect(h.frames).toEqual(['/Trip/a.mov@1']);
    expect(await h.consents.get('vision')).toMatchObject({ module: 'vision', providers: ['google'] });

    // Frames are always allowed now, yet the sound asks, with no standing consent behind it.
    expect(paused).toMatchObject({ status: 'paused', pending: [{ kind: 'consent' }] });
    expect(h.cards().at(-1)).toMatchObject({
      tool: 'audio.cloudCritique',
      upload: { modules: ['vision'], providers: ['google'], files: [], media: 'audio' },
      options: ['allow-once', 'deny'],
    });
    expect(h.sent).toEqual([]);
    const asked = ofType(await h.events(first.runId), 'approval.requested').at(-1)?.payload;
    expect(asked).toMatchObject({ kind: 'consent', reason: 'upload' });
    expect(asked?.standingConsentIds).toBeUndefined();

    const no = { requestId: paused.pending[0]!.requestId, decision: 'deny' as const };
    const done = unwrap(await h.agent.answer(first.runId, no));
    expect(done.status).toBe('completed');
    expect(h.sent).toEqual([]);
    const failed = ofType(await h.events(done.runId), 'tool.failed').map((e) => e.payload.error.code);
    expect(failed).toEqual(['tools.denied']);
    expect(await h.consents.get(SOUND_KEY)).toBeUndefined();
  });

  it('Always allow for sound covers later sound uploads on its own, and is revoked on its own', async () => {
    const consents = createMemoryConsentStore();
    await consents.grant(FRAMES);
    // An audio upload that doesn't ask every time keeps I5's standing consent per kind.
    const h = setup({ consents, alwaysAsk: false });
    const paused = unwrap(await h.agent.run(ASK));
    expect(h.cards().map((card) => card.tool)).toEqual(['audio.cloudCritique']);
    expect(h.cards()[0]?.options).toEqual(['allow-once', 'always-allow', 'deny']);
    const always = { requestId: paused.pending[0]!.requestId, decision: 'approve' as const, remember: true };
    expect(unwrap(await h.agent.answer(paused.runId, always)).status).toBe('completed');
    expect(h.sent).toEqual([h.asset]);
    const sound = await consents.get(SOUND_KEY);
    expect(sound).toMatchObject({ module: 'vision.audio', providers: ['google'] });
    // The frames consent is as it was: background work reads it by module.
    expect(await consents.get('vision')).toEqual(FRAMES);

    const next = unwrap(await h.agent.run(ASK));
    expect(next.status).toBe('completed');
    expect([h.sent.length, h.cards().length]).toEqual([2, 1]);
    const standing = ofType(await h.events(next.runId), 'approval.requested').at(-1)?.payload;
    expect(standing?.standingConsentIds).toEqual([sound!.id]);

    // Taking frames back leaves sound allowed; taking sound back asks again.
    const service = consentsService(consents);
    unwrap(await service.revoke({ module: 'vision' }));
    expect(unwrap(await h.agent.run(ASK)).status).toBe('completed');
    unwrap(await service.revoke({ module: SOUND_KEY }));
    expect(unwrap(await h.agent.run(ASK))).toMatchObject({
      status: 'paused',
      pending: [{ kind: 'consent' }],
    });
    expect([h.sent.length, h.cards().length]).toEqual([3, 2]);
  });

  it("a consent for sound doesn't cover frames", async () => {
    const consents = createMemoryConsentStore();
    await consents.grant({ ...FRAMES, id: 'sound-1', module: SOUND_KEY });
    const h = setup({ consents, frameFirst: true });
    const paused = unwrap(await h.agent.run(ASK));
    expect(paused).toMatchObject({ status: 'paused', pending: [{ kind: 'consent' }] });
    expect(h.cards().map((card) => card.tool)).toEqual(['vision.describeFrame']);
    expect(h.frames).toEqual([]);
  });

  it('Local only sends no sound and shows no card, even with sound always allowed', async () => {
    const consents = createMemoryConsentStore();
    await consents.grant(FRAMES);
    await consents.grant({ ...FRAMES, id: 'sound-1', module: SOUND_KEY });
    const h = setup({ consents });
    const done = unwrap(await h.agent.run({ ...ASK, localOnly: true }));
    expect(done.status).toBe('completed');
    const failed = ofType(await h.events(done.runId), 'tool.failed').map((e) => e.payload.error.code);
    expect(failed).toEqual(['tools.permission_denied']);
    expect([h.sent, h.cards()]).toEqual([[], []]);
  });
});
