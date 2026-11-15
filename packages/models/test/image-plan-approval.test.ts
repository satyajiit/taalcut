// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CVR2: a ChatGPT plan signed in for chat, its images not approved. The chain says exactly that
 * (models.chatgpt_images_not_connected, whose fix starts the approval) only when nothing else can make the still.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHATGPT_IMAGE_PROVIDER, SETTINGS_COMMANDS, type AsyncResult } from '@taalcut/core';
import {
  BUILTIN_PROFILES,
  ChatGptImagesNotConnected,
  createImageProviders,
  createMemoryCloudCallSink,
  createStaticCredentialProvider,
  disableNetwork,
  generateImages,
  ImageNoProvider,
  imagePathAvailable,
  SignInRequired,
  type CredentialProvider,
  type NetworkGuard,
  type ResolvedCredential,
} from '@taalcut/models';
import { refineImageCost } from '../src/images/image-chain';
import { fixtureBody, GROK, json, keys, selectorOf, signIns, URLS, wire } from './support/image-wire';

let guard: NetworkGuard;
beforeAll(() => {
  guard = disableNetwork();
});
afterAll(() => guard.restore());

const REQUEST = { prompt: 'A harbour at dawn', aspect: '9:16', size: 'final', count: 1 } as const;
const BALANCED = BUILTIN_PROFILES.find((profile) => profile.id === 'balanced')!.modules.images.chain;

function setup(credentials: CredentialProvider, chain = BALANCED) {
  const net = wire({ [URLS.openai]: () => json(fixtureBody('openai-flare')) });
  const providers = createImageProviders({
    credentials,
    callLog: createMemoryCloudCallSink(),
    localOnly: () => false,
    fetch: net.fetch,
  });
  return { net, deps: { providers, selector: selectorOf(...chain) } };
}
const errorOf = async (result: AsyncResult<unknown>) => {
  const settled = await result;
  return settled.ok ? undefined : settled.error;
};

describe('a ChatGPT plan connected for chat and not for images', () => {
  it('says images need one more approval, with a fix that starts it', async () => {
    const { net, deps } = setup(signIns('openai'));
    const error = await errorOf(generateImages(deps, REQUEST));
    expect(ChatGptImagesNotConnected.is(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'models.chatgpt_images_not_connected',
      messageKey: 'errors.models.chatgpt_images_not_connected',
      retryable: false,
      fix: { command: SETTINGS_COMMANDS.connectChatGptImages, labelKey: 'fix.connectChatGptImages' },
    });
    // The budget gate asks first and gets the same answer; the gap card sees no path.
    expect(ChatGptImagesNotConnected.is(await errorOf(refineImageCost(deps, REQUEST)))).toBe(true);
    expect(await imagePathAvailable(deps)).toBeUndefined();
    expect(net.sent).toEqual([]);
  });

  it('is not said to someone who is not signed in to ChatGPT at all', async () => {
    const error = await errorOf(generateImages(setup(keys()).deps, REQUEST));
    expect(ImageNoProvider.is(error)).toBe(true);
  });

  it('is not said for an OpenAI API key: a key is no plan, and the key makes the still', async () => {
    const { net, deps } = setup(keys('openai'), [
      { provider: 'openrouter', model: 'openai/gpt-image-2.5-flare' },
      { provider: CHATGPT_IMAGE_PROVIDER, model: 'gpt-image-2' },
    ]);
    const made = await generateImages(deps, REQUEST);
    expect(made.ok && made.value.images[0]?.provider).toBe('openai');
    expect(net.sent.map((sent) => sent.url)).toEqual([URLS.openai]);
  });

  it('still uses a paid key that works, and says nothing of the plan', async () => {
    const chat: ResolvedCredential = { kind: 'oauth_access', secret: 'oauth-openai', source: 'OAuth' };
    const paid = keys('openrouter');
    const net = wire({ [URLS.openrouter]: () => json(fixtureBody('openrouter-grok')) });
    const providers = createImageProviders({
      credentials: {
        get: (id, request) =>
          id === 'openai'
            ? createStaticCredentialProvider({ openai: chat }).get(id, request)
            : paid.get(id, request),
      },
      callLog: createMemoryCloudCallSink(),
      localOnly: () => false,
      fetch: net.fetch,
    });
    const made = await generateImages(
      { providers, selector: selectorOf(GROK, { provider: CHATGPT_IMAGE_PROVIDER, model: 'gpt-image-2' }) },
      REQUEST,
    );
    expect(made.ok && made.value.images[0]?.provider).toBe('openrouter');
  });

  it('is not said when the chain has no model the plan makes: the approval would not help', async () => {
    const error = await errorOf(generateImages(setup(signIns('openai'), [GROK]).deps, REQUEST));
    expect(ImageNoProvider.is(error)).toBe(true);
  });

  it('is not said when the chat sign-in itself cannot be read: that failure is the one to fix', async () => {
    const broken: CredentialProvider = {
      get: async (id) =>
        id === 'openai'
          ? { ok: false, error: SignInRequired({ provider: id }) }
          : { ok: true, value: undefined },
    };
    const error = await errorOf(generateImages(setup(broken).deps, REQUEST));
    expect(SignInRequired.is(error)).toBe(true);
  });

  it('is Local only’s refusal first: no cloud route is offered there', async () => {
    const providers = createImageProviders({
      credentials: signIns('openai'),
      callLog: createMemoryCloudCallSink(),
      localOnly: () => true,
    });
    const error = await errorOf(generateImages({ providers, selector: selectorOf(...BALANCED) }, REQUEST));
    expect(error?.code).toBe('core.local_only');
  });
});
