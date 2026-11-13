// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-X2 "No media leaves before consent", as a network test: the upload tool
 * calls a real @taalcut/models ModelClient whose fetch records every request
 * (and answers in the provider's wire format, offline). Nothing goes out
 * until the consent approval is in the log; Allow once lets exactly one
 * request out, carrying the frame; Local only sends nothing at all.
 */
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { frameOf, framesModule } from './support/frames-module';
import { call, harness, ofType, plan, turns } from './support/harness';
import { recordingVisionClient, type SentRequest } from './support/recording-provider';

const ASK = { conversationId: 'c', message: 'Describe the frames of my two clips.' };
const describeCall = (path: string) => ({ toolCalls: [call('frames_describe', { path })] });
const script = turns(
  plan('Describe the frames'),
  describeCall('/Users/me/Trip/a.mov'),
  describeCall('/Users/me/Trip/b.mov'),
  { text: 'Both are beach shots.' },
);

function setup(options: { readonly clientLocalOnly?: boolean } = {}) {
  const vision = recordingVisionClient(options.clientLocalOnly ? { localOnly: () => true } : {});
  const h = harness({
    script,
    modules: [framesModule(vision.client)],
    deps: { cloudProviders: () => ['cloud-vision'] },
  });
  return { ...h, sent: vision.sent, callLog: vision.callLog };
}

const carries = (request: SentRequest | undefined, path: string) =>
  request?.body.includes(frameOf(path)) ?? false;

describe('no media leaves before consent (network test)', () => {
  it('sends nothing until the consent is logged; Allow once lets exactly one frame out', async () => {
    const h = setup();
    const paused = unwrap(await h.agent.run(ASK));
    expect(paused).toMatchObject({ status: 'paused', pending: [{ kind: 'consent' }] });
    expect(h.sent).toEqual([]);
    expect(h.callLog.records).toEqual([]);

    const firstAsk = paused.pending[0]!.requestId;
    const again = unwrap(await h.agent.answer(paused.runId, { requestId: firstAsk, decision: 'approve' }));
    // The second upload asks again: Allow once covered one call, and nothing more has gone.
    expect(again).toMatchObject({ status: 'paused', pending: [{ kind: 'consent' }] });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.url).toBe('https://vision.example.test/v1/chat/completions');
    expect(carries(h.sent[0], '/Users/me/Trip/a.mov')).toBe(true);
    expect(h.sent.some((r) => carries(r, '/Users/me/Trip/b.mov'))).toBe(false);

    // The log shows the order: the approval for the first call came before its result.
    const events = await h.events(paused.runId);
    const granted = ofType(events, 'approval.granted')[0]!;
    const completed = ofType(events, 'tool.completed').find((e) => e.payload.approvalId === firstAsk)!;
    expect(granted.seq).toBeLessThan(completed.seq);

    const secondAsk = again.pending[0]!.requestId;
    const done = unwrap(await h.agent.answer(paused.runId, { requestId: secondAsk, decision: 'approve' }));
    expect(done.status).toBe('completed');
    expect(h.sent).toHaveLength(2);
    expect(carries(h.sent[1], '/Users/me/Trip/b.mov')).toBe(true);
    // One CloudCall row per request that left: the privacy panel's numbers come from these.
    expect(h.callLog.records.map((r) => [r.module, r.provider, r.local, r.outcome])).toEqual([
      ['vision', 'cloud-vision', false, 'ok'],
      ['vision', 'cloud-vision', false, 'ok'],
    ]);
    expect(h.callLog.records.every((r) => r.bytesSent > 0)).toBe(true);
  });

  it("Don't send: the frame never leaves", async () => {
    const h = setup();
    const paused = unwrap(await h.agent.run(ASK));
    const no = { requestId: paused.pending[0]!.requestId, decision: 'deny' as const };
    const next = unwrap(await h.agent.answer(paused.runId, no));
    expect(next.pending).toEqual([{ requestId: expect.any(String), kind: 'consent' }]);
    unwrap(await h.agent.answer(paused.runId, { requestId: next.pending[0]!.requestId, decision: 'deny' }));
    expect(h.sent).toEqual([]);
    const failed = ofType(await h.events(paused.runId), 'tool.failed').map((e) => e.payload.error.code);
    expect(failed).toEqual(['tools.denied', 'tools.denied']);
  });

  it('with Local only on the run, nothing ever leaves and nobody is asked', async () => {
    const h = setup();
    const outcome = unwrap(await h.agent.run({ ...ASK, localOnly: true }));
    expect(outcome.status).toBe('completed');
    expect(outcome.pending).toEqual([]);
    expect(h.sent).toEqual([]);
    const events = await h.events(outcome.runId);
    expect(ofType(events, 'approval.requested')).toEqual([]);
    // Refused by the policy's permission check, before any approval or upload.
    expect(ofType(events, 'tool.failed').map((e) => e.payload.error.code)).toEqual([
      'tools.permission_denied',
      'tools.permission_denied',
    ]);
  });

  it('with Local only on in the ModelClient, an approved upload is still refused before the wire', async () => {
    const h = setup({ clientLocalOnly: true });
    const paused = unwrap(await h.agent.run(ASK));
    const yes = { requestId: paused.pending[0]!.requestId, decision: 'approve' as const };
    const next = unwrap(await h.agent.answer(paused.runId, yes));
    expect(next.status).toBe('paused');
    expect(h.sent).toEqual([]);
    expect(h.callLog.records).toEqual([]);
    const failed = ofType(await h.events(paused.runId), 'tool.failed').map((e) => e.payload.error.code);
    expect(failed).toEqual(['core.local_only']);
  });
});
