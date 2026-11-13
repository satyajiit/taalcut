// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Background model calls (P2-L8): a 'local' call stays on this Mac's models, a
 * 'cloud' call uploads only under a standing consent covering every cloud
 * provider in the chain, and each model is called by name in chain order.
 */
import {
  createMemorySettingsStore,
  err,
  newId,
  ok,
  UPLOAD_CONSENTS_SETTING,
  type BackgroundModelRequest,
  type TaalcutError,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createBackgroundModels,
  ModelBadRequest,
  ModelProviderUnavailable,
  type ModelChoice,
  type ModelClient,
  type ModelEvent,
  type ModelRequest,
  type ModelResult,
  type ModelStream,
  type BackgroundModelsDeps,
} from '@taalcut/models';

const LOCAL = 'llama-cpp';
const CHAIN: ModelChoice[] = [
  { provider: 'openai', model: 'gpt-5.4-mini' },
  { provider: LOCAL, model: 'qwen3-vl-8b' },
  { provider: 'google', model: 'gemini-3.6-flash' },
];

const REQUEST: BackgroundModelRequest = {
  module: 'vision',
  placement: 'cloud',
  system: 'Describe the frame.',
  content: [
    { type: 'text', text: 'Frame at 2 s.' },
    { type: 'image', data: 'aGVsbG8=', mimeType: 'image/jpeg' },
  ],
  maxTokens: 400,
};

/** A client whose answer per provider is scripted; it records every request it was sent. */
function fakeClient(failures: Record<string, TaalcutError> = {}) {
  const sent: ModelRequest[] = [];
  const client: ModelClient = {
    stream(request): ModelStream {
      sent.push(request);
      const target = request.target!;
      const local = target.provider === LOCAL;
      const failure = failures[target.provider];
      const events: ModelEvent[] = [
        {
          type: 'start',
          callId: newId<'CloudCall'>(),
          module: request.module,
          ...target,
          reasoning: 'off',
          local,
        },
      ];
      const result = failure
        ? err(failure)
        : ok({
            text: `from ${target.provider}`,
            ...target,
            local,
            usage: { costUsd: 0.002 },
          } as unknown as ModelResult);
      return {
        async *[Symbol.asyncIterator]() {
          yield* events;
        },
        result: async () => result,
      };
    },
    complete: () => Promise.reject(new Error('background calls stream')),
  };
  return { client, sent };
}

async function setup(
  options: {
    failures?: Record<string, TaalcutError>;
    chain?: ModelChoice[];
    approvedUpload?: BackgroundModelsDeps['approvedUpload'];
  } = {},
) {
  const settings = createMemorySettingsStore();
  const { client, sent } = fakeClient(options.failures);
  const models = createBackgroundModels({
    client,
    selector: { resolve: (module) => ok({ module, choices: options.chain ?? CHAIN }) },
    isLocalProvider: (provider) => provider === LOCAL,
    settings,
    ...(options.approvedUpload ? { approvedUpload: options.approvedUpload } : {}),
  });
  const allow = (providers: string[]) =>
    settings.set(UPLOAD_CONSENTS_SETTING, {
      vision: { id: 'consent-1', module: 'vision', providers, grantedAt: 1 },
    });
  return { models, sent, allow, settings };
}

describe('createBackgroundModels', () => {
  it('uses a foreground approval only for its modules and named providers without saving standing consent', async () => {
    const { models, sent, settings } = await setup({
      approvedUpload: { modules: ['vision'], providers: ['openai', 'google'] },
    });
    expect(await models.complete(REQUEST)).toMatchObject(ok({ status: 'answered', provider: 'openai' }));
    expect(await models.complete({ ...REQUEST, module: 'agent' })).toEqual(
      ok({ status: 'skipped', reason: 'no_consent', uploadedTo: [] }),
    );
    expect(sent).toHaveLength(1);
    expect(await settings.get(UPLOAD_CONSENTS_SETTING)).toEqual(ok({}));
    const changed = await setup({ approvedUpload: { modules: ['vision'], providers: ['openai'] } });
    await changed.allow(['openai', 'google']);
    expect(await changed.models.complete(REQUEST)).toEqual(
      ok({ status: 'skipped', reason: 'no_consent', uploadedTo: [] }),
    );
    expect(changed.sent).toEqual([]);
  });
  it('keeps a local call on this Mac: only on-device models are tried', async () => {
    const { models, sent } = await setup();
    const result = await models.complete({ ...REQUEST, placement: 'local' });
    expect(result).toEqual(
      ok({
        status: 'answered',
        text: `from ${LOCAL}`,
        provider: LOCAL,
        model: 'qwen3-vl-8b',
        local: true,
        costUsd: 0.002,
        uploadedTo: [],
      }),
    );
    expect(sent.map((r) => r.target?.provider)).toEqual([LOCAL]);
    expect(sent[0]).toMatchObject({
      module: 'vision',
      system: 'Describe the frame.',
      reasoning: 'off',
      maxTokens: 400,
      messages: [{ role: 'user', content: REQUEST.content }],
    });
  });

  it('skips a local call when the chain has no on-device model', async () => {
    const { models, sent } = await setup({ chain: [CHAIN[0]!, CHAIN[2]!] });
    expect(await models.complete({ ...REQUEST, placement: 'local' })).toEqual(
      ok({ status: 'skipped', reason: 'no_local_model', uploadedTo: [] }),
    );
    expect(sent).toEqual([]);
  });

  it('skips a cloud call without a standing consent covering every cloud provider', async () => {
    const { models, sent, allow } = await setup();
    const skipped = ok({ status: 'skipped', reason: 'no_consent', uploadedTo: [] });
    expect(await models.complete(REQUEST)).toEqual(skipped);
    await allow(['openai']);
    expect(await models.complete(REQUEST)).toEqual(skipped);
    expect(sent).toEqual([]);
  });

  it('falls back down the chain under consent and reports every upload', async () => {
    const { models, sent, allow } = await setup({
      failures: {
        openai: ModelProviderUnavailable({ provider: 'openai' }),
        [LOCAL]: ModelProviderUnavailable({ provider: LOCAL }),
      },
    });
    await allow(['openai', 'google']);
    const projectId = newId<'Project'>();
    const result = await models.complete({ ...REQUEST, projectId, temperature: 0.2 });
    expect(result).toMatchObject(
      ok({ status: 'answered', provider: 'google', uploadedTo: ['openai', 'google'] }),
    );
    expect(sent.map((r) => r.target?.provider)).toEqual(['openai', LOCAL, 'google']);
    expect(sent[0]).toMatchObject({ trace: { projectId }, temperature: 0.2 });
  });

  it('stops at an error the next model would hit too', async () => {
    const bad = ModelBadRequest({ provider: 'openai' });
    const { models, sent, allow } = await setup({ failures: { openai: bad } });
    await allow(['openai', 'google']);
    expect(await models.complete(REQUEST)).toEqual(err(bad));
    expect(sent).toHaveLength(1);
  });

  it('answers a cancelled call without calling a model', async () => {
    const { models, sent } = await setup();
    const controller = new AbortController();
    controller.abort();
    const result = await models.complete({ ...REQUEST, placement: 'local' }, controller.signal);
    expect(!result.ok && result.error.code).toBe('core.cancelled');
    expect(sent).toEqual([]);
  });
});
