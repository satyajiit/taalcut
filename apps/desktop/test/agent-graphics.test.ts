// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ: the breakdown's graphic reader in the agent process, over a scripted ModelClient. The chat's model reads
 * a reel's graphics when it can see images, else the vision chain does; a failing chat model falls back to the chain.
 * Every call is temperature 0 with thinking off and carries the sheet. Roots that replay recorded sessions get none.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createScriptedModelClient } from '@taalcut/agent';
import { createContainer, TimeoutError } from '@taalcut/core';
import type { ModelProfiles, ModelRequest, ModelRuntime } from '@taalcut/models';
import type { GraphicModelRequest } from '@taalcut/templates';
import { ModelClientToken, ModelProfilesToken, ModelRuntimeToken } from '../src/shared/tokens';
import { graphicModelOf } from '../src/utility/roots/agent-graphics';

const SHEET = { type: 'image' as const, data: 'iVBORw0KGgo=', mimeType: 'image/png' as const };
const request: GraphicModelRequest = {
  system: 'Read it',
  content: [{ type: 'text' as const, text: 'Text #1 of 1.' }, SHEET],
  maxTokens: 400,
};

function root(options: { seesImages?: boolean; chatFails?: boolean; withClient?: boolean } = {}) {
  const client = createScriptedModelClient((req: ModelRequest) =>
    req.target && options.chatFails
      ? { error: TimeoutError({ ms: 1000 }) }
      : {
          text: '{"graphic": true}',
          provider: req.target ? 'anthropic' : 'local-runtime',
          model: req.target ? 'claude' : 'qwen3.5-4b',
        },
  );
  const profiles = {
    resolve: () => ({ ok: true, value: { choices: [{ provider: 'anthropic', model: 'claude' }] } }),
  } as unknown as ModelProfiles;
  const runtime = {
    findModel: () => ({ input: options.seesImages === false ? ['text'] : ['text', 'image'] }),
  } as unknown as ModelRuntime;
  const c = createContainer().value(ModelProfilesToken, profiles).value(ModelRuntimeToken, runtime);
  if (options.withClient !== false) c.value(ModelClientToken, client);
  return { c, client };
}

afterEach(() => {
  delete process.env['TAALCUT_TEST_RECORDED_MODELS'];
});

describe('the breakdown’s graphic reader (DSG1-READ)', () => {
  it('asks the chat’s model when it can see images: the sheet, temperature 0, thinking off', async () => {
    const { c, client } = root();
    const answer = await graphicModelOf(c).graphicModel!.complete(request);
    expect(answer.ok && answer.value).toMatchObject({ provider: 'anthropic', model: 'claude' });
    const sent = client.requests[0]!;
    expect(sent).toMatchObject({
      module: 'vision',
      temperature: 0,
      reasoning: 'off',
      target: { provider: 'anthropic', model: 'claude', reasoning: 'off' },
    });
    const asked = sent.messages[0]!;
    expect(asked.role === 'user' && asked.content).toContainEqual(SHEET);
    expect(sent.trace?.spanId).toBeTruthy();
  });

  it('asks the vision chain when the chat’s model can’t see, or fails', async () => {
    const blind = root({ seesImages: false });
    const answer = await graphicModelOf(blind.c).graphicModel!.complete(request);
    expect(answer.ok && answer.value.model).toBe('qwen3.5-4b');
    expect(blind.client.requests).toHaveLength(1);
    expect(blind.client.requests[0]!.target).toBeUndefined();

    const failing = root({ chatFails: true });
    const again = await graphicModelOf(failing.c).graphicModel!.complete(request);
    expect(again.ok && again.value.model).toBe('qwen3.5-4b');
    expect(failing.client.requests.map((r) => r.target?.provider ?? 'chain')).toEqual(['anthropic', 'chain']);
  });

  it('gives no reader to roots that replay recorded sessions, or have no model client', () => {
    expect(graphicModelOf(root({ withClient: false }).c)).toEqual({});
    process.env['TAALCUT_TEST_RECORDED_MODELS'] = '1';
    expect(graphicModelOf(root().c)).toEqual({});
  });
});
