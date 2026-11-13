// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Upload consent (PRD G9, packages/vision/SPEC.md "Consent"): the first time
 * the user's media would go to a cloud model the user is asked, at every
 * autonomy level; "Always allow" becomes a per-call logged approval; it is
 * never silent, and a restart asks again about an upload that may have gone.
 * A reference's frames never ask, and are logged the same way.
 */
import { unwrap } from '@taalcut/core';
import { consentsService, createMemoryConsentStore, type AgentCard, type ConsentStore } from '@taalcut/agent';
import { describe, expect, it, vi } from 'vitest';
import { cloudVisionModule } from './support/fixtures';
import { call, harness, ofType, plan, turns } from './support/harness';

const ASK = { conversationId: 'c', message: 'What is in the first video?' };
const frame = (atSeconds: number) => ({
  toolCalls: [call('vision_describeFrame', { path: '/Trip/a.mov', atSeconds })],
});
const script = turns(plan('Describe two frames'), frame(1), frame(2), { text: 'Done.' });

function setup(
  options: {
    consents?: ConsentStore;
    providers?: string[];
    hold?: () => Promise<void>;
    writeUpload?: boolean;
  } = {},
) {
  const uploads: string[] = [];
  const consents = options.consents ?? createMemoryConsentStore();
  const h = harness({
    script,
    modules: [
      cloudVisionModule({
        uploads,
        writeUpload: options.writeUpload,
        ...(options.hold ? { hold: options.hold } : {}),
      }),
    ],
    deps: { consents, cloudProviders: () => options.providers ?? ['google'] },
  });
  const consentCards = () =>
    h.ui.flatMap((e) => (e.type === 'agent.card' && e.card.kind === 'consent' ? [e.card] : []));
  return { ...h, uploads, consents, consentCards };
}

describe('upload consent', () => {
  it.each([false, true])(
    'asks before uploading even on autopilot; Allow once covers one call (write upload: %s)',
    async (writeUpload) => {
      const h = setup({ writeUpload });
      const paused = unwrap(await h.agent.run(ASK));
      expect(paused).toMatchObject({ status: 'paused', pending: [{ kind: 'consent' }] });
      expect(h.uploads).toEqual([]);
      expect(h.consentCards()).toEqual([
        expect.objectContaining<Partial<Extract<AgentCard, { kind: 'consent' }>>>({
          tool: 'vision.describeFrame',
          input: { path: '/Trip/a.mov', atSeconds: 1 },
          upload: {
            modules: ['vision'],
            providers: ['google'],
            files: ['/Trip/a.mov'],
            sources: ['user-media'],
          },
          estimate: { usd: 0.004, tokens: 1500 },
          options: ['allow-once', 'always-allow', 'deny'],
        }),
      ]);

      const once = { requestId: paused.pending[0]!.requestId, decision: 'approve' as const };
      const again = unwrap(await h.agent.answer(paused.runId, once));
      expect(again).toMatchObject({ status: 'paused', pending: [{ kind: 'consent' }] });
      expect(h.uploads).toEqual(['/Trip/a.mov@1']);

      const no = { requestId: again.pending[0]!.requestId, decision: 'deny' as const };
      const done = unwrap(await h.agent.answer(paused.runId, no));
      expect(done.status).toBe('completed');
      expect(h.uploads).toEqual(['/Trip/a.mov@1']);
      const failed = ofType(await h.events(done.runId), 'tool.failed').map((e) => e.payload.error.code);
      expect(failed).toEqual(['tools.denied']);
      expect(await h.consents.get('vision')).toBeUndefined();
    },
  );

  it("sends a reference's frames without a card, each a logged approval for its call", async () => {
    const sheet = (atSeconds: number) => ({
      toolCalls: [call('vision_describeFrame', { path: '/appData/scratch/exp-1/sheet.jpg', atSeconds })],
    });
    const uploads: string[] = [];
    const consents = createMemoryConsentStore();
    const h = harness({
      script: turns(plan('Inspect the reference contact sheet'), sheet(0), sheet(1), { text: 'Confirmed.' }),
      modules: [cloudVisionModule({ uploads })],
      deps: {
        consents: createMemoryConsentStore(),
        cloudProviders: () => ['google'],
        scratchRoot: '/appData/scratch',
      },
    });
    const done = unwrap(await h.agent.run(ASK));
    expect(done.status).toBe('completed');
    expect(uploads).toEqual(['/appData/scratch/exp-1/sheet.jpg@0', '/appData/scratch/exp-1/sheet.jpg@1']);
    expect(h.ui.filter((e) => e.type === 'agent.card' && e.card.kind === 'consent')).toEqual([]);

    const events = await h.events(done.runId);
    const requested = ofType(events, 'approval.requested').map((e) => e.payload);
    expect(requested).toEqual([
      expect.objectContaining({
        kind: 'consent',
        reason: 'reference',
        reference: true,
        upload: {
          modules: ['vision'],
          providers: ['google'],
          files: ['/appData/scratch/exp-1/sheet.jpg'],
          sources: ['reference'],
        },
      }),
      expect.objectContaining({ reason: 'reference', reference: true }),
    ]);
    expect(ofType(events, 'approval.granted').map((e) => e.payload.requestId)).toEqual(
      requested.map((r) => r.requestId),
    );
    const approvals = ofType(events, 'tool.completed').flatMap((e) => e.payload.approvalId ?? []);
    expect(approvals).toEqual(requested.map((r) => r.requestId));
    // Nothing standing is left behind: the person's own clips still ask the first time.
    expect(await consents.list()).toEqual([]);
  });

  it.each(['/Users/me/scratch/clip.jpg', '/appData/scratch/../Trip/a.jpg', 'scratch/exp-1/sheet.jpg'])(
    "asks for %s: only a file inside the app's scratch folder is a reference",
    async (path) => {
      const h = harness({
        script: turns(plan('Describe'), {
          toolCalls: [call('vision_describeFrame', { path, atSeconds: 0 })],
        }),
        modules: [cloudVisionModule()],
        deps: {
          consents: createMemoryConsentStore(),
          cloudProviders: () => ['google'],
          scratchRoot: '/appData/scratch',
        },
      });
      const paused = unwrap(await h.agent.run(ASK));
      expect(paused).toMatchObject({ status: 'paused', pending: [{ kind: 'consent' }] });
      const card = h.ui.flatMap((e) =>
        e.type === 'agent.card' && e.card.kind === 'consent' ? [e.card] : [],
      )[0];
      expect(card?.upload.sources).toEqual(['user-media']);
    },
  );

  it('turns Always allow into a logged approval per upload, in this run and the next', async () => {
    const h = setup();
    const paused = unwrap(await h.agent.run(ASK));
    const always = { requestId: paused.pending[0]!.requestId, decision: 'approve' as const, remember: true };
    const done = unwrap(await h.agent.answer(paused.runId, always));
    expect(done.status).toBe('completed');
    expect(h.uploads).toEqual(['/Trip/a.mov@1', '/Trip/a.mov@2']);
    const consent = await h.consents.get('vision');
    expect(consent).toMatchObject({ module: 'vision', providers: ['google'] });

    const events = await h.events(done.runId);
    const requested = ofType(events, 'approval.requested');
    const granted = ofType(events, 'approval.granted');
    expect(requested.map((e) => e.payload.standingConsentIds)).toEqual([undefined, [consent!.id]]);
    expect(granted.map((e) => e.payload.consentIds)).toEqual([[consent!.id], [consent!.id]]);
    // Every upload carries the approval logged for its own call.
    const approvals = ofType(events, 'tool.completed').flatMap((e) => e.payload.approvalId ?? []);
    expect(approvals).toEqual(requested.map((e) => e.payload.requestId));
    expect(h.consentCards()).toHaveLength(1);

    const next = unwrap(await h.agent.run(ASK));
    expect(next.status).toBe('completed');
    expect(h.uploads).toHaveLength(4);
    expect(ofType(await h.events(next.runId), 'approval.granted')).toHaveLength(2);
  });

  it('asks again once Always allow is revoked: in the next run, and in a run already going', async () => {
    const h = setup();
    const service = consentsService(h.consents);
    const paused = unwrap(await h.agent.run(ASK));
    const always = { requestId: paused.pending[0]!.requestId, decision: 'approve' as const, remember: true };
    unwrap(await h.agent.answer(paused.runId, always));
    expect(unwrap(await service.list())).toEqual([
      { module: 'vision', providers: ['google'], grantedAt: expect.any(Number) },
    ]);

    expect(unwrap(await service.revoke({ module: 'vision' }))).toEqual({ module: 'vision', revoked: true });
    expect(unwrap(await service.list())).toEqual([]);
    // Idempotent: nothing left to take back.
    expect(unwrap(await service.revoke({ module: 'vision' }))).toEqual({ module: 'vision', revoked: false });
    const next = unwrap(await h.agent.run(ASK));
    expect(next).toMatchObject({ status: 'paused', pending: [{ kind: 'consent' }] });
    expect(h.consentCards()).toHaveLength(2);

    // Always allow again, and revoked while the run is still going: its second upload asks.
    let release = () => {};
    const between = new Promise<void>((resolve) => (release = resolve));
    const slow = setup({ consents: h.consents, hold: () => between });
    const run = unwrap(await slow.agent.start(ASK));
    await vi.waitFor(() => expect(slow.consentCards()).toHaveLength(1));
    const first = slow.consentCards()[0]!.requestId;
    const answered = slow.agent.answer(run, { requestId: first, decision: 'approve', remember: true });
    await vi.waitFor(async () => expect(await slow.consents.get('vision')).toBeDefined());
    unwrap(await consentsService(slow.consents).revoke({ module: 'vision' }));
    release();
    expect(unwrap(await answered)).toMatchObject({ status: 'paused', pending: [{ kind: 'consent' }] });
    expect(slow.uploads).toEqual(['/Trip/a.mov@1']);
  });

  it('lists standing consents by module, and reports a store failure as an error value', async () => {
    const consents = createMemoryConsentStore();
    await consents.grant({ id: 'c-2', module: 'voice', providers: ['openai'], grantedAt: 2 });
    await consents.grant({ id: 'c-1', module: 'vision', providers: ['google', 'openai'], grantedAt: 1 });
    expect(unwrap(await consentsService(consents).list()).map((c) => c.module)).toEqual(['vision', 'voice']);
    const broken: ConsentStore = { ...consents, list: () => Promise.reject(new Error('disk gone')) };
    expect((await consentsService(broken).list()).ok).toBe(false);
  });

  it('asks again when the module may now send to a provider the consent does not cover', async () => {
    const consents = createMemoryConsentStore();
    await consents.grant({ id: 'c-1', module: 'vision', providers: ['google'], grantedAt: 0 });
    const h = setup({ consents, providers: ['google', 'openai'] });
    const paused = unwrap(await h.agent.run(ASK));
    expect(paused).toMatchObject({ status: 'paused', pending: [{ kind: 'consent' }] });
    expect(h.consentCards()[0]?.upload.providers).toEqual(['google', 'openai']);
  });

  it('sends nothing and shows no card in local-only mode', async () => {
    const h = setup();
    const done = unwrap(await h.agent.run({ ...ASK, localOnly: true }));
    expect(done.status).toBe('completed');
    const failed = ofType(await h.events(done.runId), 'tool.failed').map((e) => e.payload.error.code);
    expect(failed).toEqual(['tools.permission_denied', 'tools.permission_denied']);
    expect([h.uploads, h.consentCards()]).toEqual([[], []]);
  });

  it('asks again after a restart about an upload that may have gone, despite a standing consent', async () => {
    const consents = createMemoryConsentStore();
    await consents.grant({ id: 'c-1', module: 'vision', providers: ['google'], grantedAt: 0 });
    let started = () => {};
    const running = new Promise<void>((resolve) => (started = resolve));
    // The first process starts the upload and dies mid-call (its call never returns).
    const first = setup({ consents, hold: () => (started(), new Promise(() => {})) });
    const runId = unwrap(await first.agent.start(ASK));
    await running;

    const store = first.store;
    const restarted = harnessOn(store, consents);
    const paused = unwrap(await restarted.agent.resume(runId));
    expect(paused).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });
    expect(restarted.uploads).toEqual([]);
    const reason = ofType(unwrap(await store.read(runId)), 'approval.requested').at(-1)?.payload.reason;
    expect(reason).toBe('unsure-after-restart');
    await first.agent.cancel(runId);
  });
});

/** A second agent process on the first one's log, with the same consents. */
function harnessOn(store: ReturnType<typeof setup>['store'], consents: ConsentStore) {
  const uploads: string[] = [];
  const h = harness({
    script,
    store,
    modules: [cloudVisionModule({ uploads })],
    deps: { consents, cloudProviders: () => ['google'] },
  });
  return { ...h, uploads };
}
