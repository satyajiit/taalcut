// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B10, Local only in a run: the switch as it is now is what run.started logs; a tool whose internet use is
 * its cloud modules runs on this Mac when those modules have a model here, logged and never asked (nothing
 * leaves, the model client sends only to the model on this Mac); anything else online is refused.
 */
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { LOCAL_ONLY_REFUSAL, localOnlyRefusal, type LocalOnlyDeps } from '../../src';
import { RunTranslator } from '../../src/chat-translate';
import { framesModule } from '../support/frames-module';
import { call, harness, ofType, plan, turns } from '../support/harness';
import { LOCAL_VISION, recordingVisionClient } from '../support/recording-provider';

const ASK = { conversationId: 'c', message: 'Describe the frames of my two clips.' };
const describeCall = (path: string) => ({ toolCalls: [call('frames_describe', { path })] });
const script = turns(
  plan('Describe the frames'),
  describeCall('/Users/me/Trip/a.mov'),
  describeCall('/Users/me/Trip/b.mov'),
  { text: 'Both are beach shots.' },
);

/** Local only read from a switch the test flips; `onDevice` says which modules have a model on this Mac. */
function setup(options: { readonly on: boolean; readonly onDevice: (module: string) => boolean }) {
  const flag = { on: options.on };
  const localOnly: LocalOnlyDeps = { now: () => flag.on, onDevice: options.onDevice };
  const vision = recordingVisionClient({ localOnly: () => flag.on, onDevice: true });
  const h = harness({
    script,
    modules: [framesModule(vision.client)],
    deps: { cloudProviders: () => ['cloud-vision'], phase3: { localOnly } },
  });
  return { ...h, flag, sent: vision.sent, callLog: vision.callLog };
}

describe('Local only in a run (P3-B10)', () => {
  it('describes on this Mac with nobody asked and nothing sent off it; run.started says Local only', async () => {
    const h = setup({ on: true, onDevice: (module) => module === 'vision' });
    const outcome = unwrap(await h.agent.run(ASK));
    expect(outcome.status).toBe('completed');
    const events = await h.events(outcome.runId);
    expect(ofType(events, 'run.started')[0]!.payload.localOnly).toBe(true);

    // Each upload's approval is logged as Local only's, granted at once, with no provider it could go to.
    const asked = ofType(events, 'approval.requested');
    expect(asked.map((e) => [e.payload.kind, e.payload.reason, e.payload.localOnly])).toEqual([
      ['consent', 'local-only', true],
      ['consent', 'local-only', true],
    ]);
    expect(asked.every((e) => e.payload.upload?.providers.length === 0)).toBe(true);
    expect(ofType(events, 'approval.granted')).toHaveLength(2);

    // Every request went to the model on this Mac.
    expect(h.sent.length).toBe(2);
    expect(h.sent.every((r) => r.url.startsWith('http://127.0.0.1:8090/'))).toBe(true);
    expect(h.callLog.records.map((r) => [r.provider, r.local])).toEqual([
      [LOCAL_VISION.provider, true],
      [LOCAL_VISION.provider, true],
    ]);
    // No consent card, live or in the chat's history.
    expect(h.ui.filter((e) => e.type === 'agent.card' && e.card.kind === 'consent')).toEqual([]);
    const translator = new RunTranslator(outcome.runId);
    const chat = events.flatMap((event) => translator.logged(event));
    expect(chat.filter((e) => e.type === 'agent.card' && e.payload.card.type === 'consent')).toEqual([]);
  });

  it('refuses a cloud-module tool whose module has nothing on this Mac, before anyone is asked', async () => {
    const h = setup({ on: true, onDevice: () => false });
    const outcome = unwrap(await h.agent.run(ASK));
    const events = await h.events(outcome.runId);
    expect(ofType(events, 'approval.requested')).toEqual([]);
    expect(ofType(events, 'tool.failed').map((e) => e.payload.error.code)).toEqual([
      'tools.permission_denied',
      'tools.permission_denied',
    ]);
    expect(h.sent).toEqual([]);
  });

  it('a switch turned on mid-run applies to the next call: no second consent', async () => {
    const h = setup({ on: false, onDevice: (module) => module === 'vision' });
    const paused = unwrap(await h.agent.run(ASK));
    expect(paused).toMatchObject({ status: 'paused', pending: [{ kind: 'consent' }] });
    const events = await h.events(paused.runId);
    expect(ofType(events, 'run.started')[0]!.payload.localOnly).toBe(false);

    h.flag.on = true;
    const yes = { requestId: paused.pending[0]!.requestId, decision: 'approve' as const };
    const done = unwrap(await h.agent.answer(paused.runId, yes));
    expect(done.status).toBe('completed');
    const asked = ofType(await h.events(paused.runId), 'approval.requested');
    expect(asked.map((e) => e.payload.reason)).toEqual(['upload', 'local-only']);
    // The approved call went to this Mac too: the model client reads the switch on every call.
    expect(h.sent.every((r) => r.url.startsWith('http://127.0.0.1:8090/'))).toBe(true);
  });
});

describe('localOnlyRefusal', () => {
  const vision = (module: string) => module === 'vision';
  it.each([
    [
      'a cloud-module tool whose modules all run here',
      { network: 'internet', cloudModules: ['vision'] },
      vision,
      undefined,
    ],
    [
      'one of its modules has nothing here',
      { network: 'internet', cloudModules: ['vision', 'voice'] },
      vision,
      LOCAL_ONLY_REFUSAL,
    ],
    [
      'nothing says what runs here',
      { network: 'internet', cloudModules: ['vision'] },
      undefined,
      LOCAL_ONLY_REFUSAL,
    ],
    ['online for anything else (a link fetch)', { network: 'internet' }, vision, LOCAL_ONLY_REFUSAL],
    ['a loopback server', { network: 'lan' }, undefined, undefined],
    ['no network at all', {}, undefined, undefined],
  ] as const)('%s', (_name, permission, onDevice, refusal) => {
    expect(localOnlyRefusal(permission, onDevice)).toBe(refusal);
  });
});
