// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  createContainer,
  createMemoryEventLogStore,
  createMemorySettingsStore,
  EventLogStoreToken,
  newId,
  ok,
  SettingsStoreToken,
  UPLOAD_CONSENTS_SETTING,
  unwrap,
  type BackgroundModelRequest,
} from '@taalcut/core';
import {
  createScriptedModelClient,
  fromCoreEventLog,
  type NewAgentEvent,
  type UploadScope,
} from '@taalcut/agent';
import type { ModelChoice, ModelProfiles, ModelRuntime } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { ModelClientToken, ModelProfilesToken, ModelRuntimeToken } from '../src/shared/tokens';
import { LocalOnlyFlagToken } from '../src/utility/roots/agent-local-only-flag';
import {
  approvedToolModels,
  completeApprovedToolModel,
  toolUploadApproval,
} from '../src/utility/roots/agent-tool-models';

const REQUEST: BackgroundModelRequest = {
  module: 'vision',
  placement: 'cloud',
  system: 'Describe the supplied source.',
  content: [{ type: 'text', text: 'Source transcript' }],
  maxTokens: 100,
};

function setup() {
  const ctx = {
    runId: newId<'AgentRun'>(),
    callId: newId<'ToolRun'>(),
    signal: new AbortController().signal,
  };
  const store = createMemoryEventLogStore();
  const log = fromCoreEventLog(store);
  let seq = 0;
  const append = async (event: NewAgentEvent) => {
    seq = unwrap(await log.append(ctx.runId, seq, [event])) + 1;
  };
  const settings = createMemorySettingsStore();
  let choices: ModelChoice[] = [{ provider: 'openai', model: 'recorded' }];
  let onDevice = false;
  const client = createScriptedModelClient(() => ({ text: 'Recorded answer' }));
  const container = createContainer()
    .value(EventLogStoreToken, store)
    .value(SettingsStoreToken, settings)
    .value(ModelClientToken, client)
    .value(ModelProfilesToken, {
      resolve: (module: string) => ok({ module, choices }),
    } as unknown as ModelProfiles)
    .value(ModelRuntimeToken, {
      isLocalProvider: (provider: string) => provider === 'local',
    } as unknown as ModelRuntime)
    .value(LocalOnlyFlagToken, { get: () => onDevice, refresh: async () => {} });
  const scope: UploadScope = { modules: ['vision', 'agent'], providers: ['openai'], files: [], sources: [] };
  async function approve(status: 'granted' | 'denied' | 'pending' = 'granted', localOnly = false) {
    await append({
      type: 'tool.requested',
      v: 1,
      at: 1,
      payload: {
        toolCallId: ctx.callId,
        modelCallId: 'model',
        modelToolCallId: 'call',
        tool: 'shorts.generate',
        callName: 'shorts_generate',
        meta: false,
        input: {},
        sideEffect: 'write',
      },
    });
    const requestId = newId<'Approval'>();
    await append({
      type: 'approval.requested',
      v: 1,
      at: 2,
      payload: {
        requestId,
        kind: 'consent',
        reason: 'upload',
        toolCallIds: [ctx.callId],
        upload: scope,
        ...(localOnly ? { localOnly: true } : {}),
      },
    });
    if (status === 'granted') await append({ type: 'approval.granted', v: 1, at: 3, payload: { requestId } });
    if (status === 'denied') await append({ type: 'approval.denied', v: 1, at: 3, payload: { requestId } });
  }
  return {
    ctx,
    container,
    client,
    scope,
    approve,
    settings,
    choices: (next: ModelChoice[]) => {
      choices = next;
    },
    localOnly: () => {
      onDevice = true;
    },
  };
}

describe('foreground tool model consent', () => {
  it('uses the actual granted call scope for text and designer calls, without saving Always allow', async () => {
    const s = setup();
    await s.approve();
    expect(await toolUploadApproval(s.container, s.ctx)).toEqual(ok(s.scope));
    expect(await approvedToolModels(s.container, s.ctx).complete(REQUEST)).toMatchObject(
      ok({ status: 'answered' }),
    );
    const design = await completeApprovedToolModel(s.container, s.ctx, { module: 'agent', messages: [] });
    expect(design.ok).toBe(true);
    expect(s.client.requests.map((r) => r.target?.provider)).toEqual(['openai', 'openai']);
    expect(await s.settings.get(UPLOAD_CONSENTS_SETTING)).toEqual(ok({}));
    expect(await toolUploadApproval(s.container, { ...s.ctx, callId: newId<'ToolRun'>() })).toEqual(
      ok(undefined),
    );
  });

  it.each(['denied', 'pending'] as const)('does not treat a %s consent as permission', async (status) => {
    const s = setup();
    await s.approve(status);
    expect(await approvedToolModels(s.container, s.ctx).complete(REQUEST)).toEqual(
      ok({ status: 'skipped', reason: 'no_consent', uploadedTo: [] }),
    );
    expect(s.client.requests).toEqual([]);
  });

  it('rejects a new cloud provider, an unapproved module, and a local-only automatic approval', async () => {
    const s = setup();
    await s.approve();
    s.choices([{ provider: 'google', model: 'new-profile' }]);
    await s.settings.set(UPLOAD_CONSENTS_SETTING, {
      agent: { id: 'other-consent', module: 'agent', providers: ['google'], grantedAt: 1 },
    });
    expect((await completeApprovedToolModel(s.container, s.ctx, { module: 'agent', messages: [] })).ok).toBe(
      false,
    );
    s.choices([{ provider: 'openai', model: 'recorded' }]);
    expect(
      await approvedToolModels(s.container, s.ctx).complete({ ...REQUEST, module: 'voice' }),
    ).toMatchObject(ok({ status: 'skipped', reason: 'no_consent' }));
    expect(s.client.requests).toEqual([]);
    const local = setup();
    await local.approve('granted', true);
    expect(await toolUploadApproval(local.container, local.ctx)).toEqual(ok(undefined));
  });

  it('keeps Local only on local targets and honors cancellation after an approval', async () => {
    const s = setup();
    await s.approve();
    s.choices([
      { provider: 'openai', model: 'cloud' },
      { provider: 'local', model: 'on-device' },
    ]);
    s.localOnly();
    expect((await approvedToolModels(s.container, s.ctx).complete(REQUEST)).ok).toBe(true);
    expect(s.client.requests.map((r) => r.target?.provider)).toEqual(['local']);
    const cancelled = await approvedToolModels(s.container, {
      ...s.ctx,
      signal: AbortSignal.abort(),
    }).complete(REQUEST);
    expect(!cancelled.ok && cancelled.error.code).toBe('core.cancelled');
    expect(s.client.requests).toHaveLength(1);
  });
});
