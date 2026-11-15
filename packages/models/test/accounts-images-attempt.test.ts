// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CVR2: the images half of Continue with ChatGPT is never dropped silently. The accounts state says while its
 * page is open (`imagesAttempt.state: 'waiting'`) and how it ended when it did not connect (`failed`, with the
 * error's code); it says nothing once images are connected, after a sign-out, or of a try that was cancelled.
 */
import {
  CancelledError,
  CHATGPT_IMAGE_PROVIDER,
  err,
  ok,
  type AccountsState,
  type Result,
} from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAccountsService,
  SignInFailed,
  SignInTimeout,
  type AccountsService,
  type AccountStatus,
  type AuthBroker,
} from '@taalcut/models';
import { createAccountsHarness, type AccountsHarness } from './support/accounts';

let h: AccountsHarness | undefined;
let service: AccountsService | undefined;
afterEach(async () => {
  service?.dispose();
  await h?.close();
});

const NOW = 1_760_000_000_000;
const value = <T>(result: { ok: true; value: T } | { ok: false }) => {
  if (!result.ok) throw new Error('expected ok');
  return result.value;
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const connected = (provider: string): Result<AccountStatus> =>
  ok({ provider, signedIn: true, method: 'subscription', planLabelKey: 'k' });

/** The harness's broker, with the images' own sign-in held open until the test settles it. */
async function setup() {
  h = await createAccountsHarness();
  const base = h.broker;
  const asked: string[] = [];
  const settle: ((outcome: Result<AccountStatus> | Error) => void)[] = [];
  let imagesIn = false;
  const broker: AuthBroker = {
    ...base,
    signIn: (provider, request) => {
      if (provider !== CHATGPT_IMAGE_PROVIDER) return base.signIn(provider, request);
      asked.push(provider);
      return new Promise((resolve, reject) =>
        settle.push((outcome) => {
          if (outcome instanceof Error) return reject(outcome);
          imagesIn = outcome.ok;
          resolve(outcome);
        }),
      );
    },
    cancelSignIn: () => undefined,
    statuses: async () => {
      const all = await base.statuses();
      if (!all.ok || !imagesIn) return all;
      return ok([...all.value, value(connected(CHATGPT_IMAGE_PROVIDER))]);
    },
  };
  service = createAccountsService({
    broker,
    runtime: h.mainRuntime,
    testApiKey: async () => ok(undefined),
    imagesWithChatGPT: true,
    now: () => NOW,
  });
  const images = async () => value(await service!.state()).chatgpt;
  return { service, asked, settle, images };
}

describe('the images half of Continue with ChatGPT', () => {
  it('says its page is open as soon as the chat sign-in is answered', async () => {
    const { service, asked } = await setup();
    const answered = value(await service.signIn({ provider: 'openai-codex' }));
    expect(asked).toEqual([CHATGPT_IMAGE_PROVIDER]);
    expect(answered.chatgpt).toMatchObject({
      signedIn: true,
      imagesSignedIn: false,
      imagesAttempt: { state: 'waiting', at: NOW },
    });
  });

  it('says so when the page was closed and the sign-in timed out, and every window hears it', async () => {
    const { service, settle, images } = await setup();
    const seen: AccountsState['chatgpt'][] = [];
    const stop = new AbortController();
    const listening = (async () => {
      for await (const state of service.changed(stop.signal)) seen.push(state.chatgpt);
    })();
    await service.signIn({ provider: 'openai-codex' });
    settle.shift()?.(err(SignInTimeout({ provider: CHATGPT_IMAGE_PROVIDER, seconds: 300 })));
    await tick();
    expect(await images()).toMatchObject({
      signedIn: true,
      imagesSignedIn: false,
      imagesAttempt: { state: 'failed', at: NOW, errorCode: 'models.sign_in_timeout' },
    });
    await tick();
    stop.abort();
    await listening;
    expect(seen.some((chatgpt) => chatgpt.imagesAttempt?.state === 'waiting')).toBe(true);
    expect(seen.at(-1)?.imagesAttempt).toMatchObject({
      state: 'failed',
      errorCode: 'models.sign_in_timeout',
    });
  });

  it('says so when the sign-in threw (the built app could not load the flow, 2026-11-14)', async () => {
    const { service, settle, images } = await setup();
    await service.signIn({ provider: 'openai-codex' });
    settle.shift()?.(new Error('Cannot find module openai-codex.js'));
    await tick();
    expect((await images()).imagesAttempt).toEqual({
      state: 'failed',
      at: NOW,
      errorCode: SignInFailed.code,
    });
  });

  it('offers them again from the row: a failure there is answered and kept, a success clears it', async () => {
    const { service, settle, images } = await setup();
    await service.signIn({ provider: 'openai-codex' });
    settle.shift()?.(err(SignInFailed({ provider: CHATGPT_IMAGE_PROVIDER })));
    await tick();

    const again = service.signIn({ provider: CHATGPT_IMAGE_PROVIDER });
    await tick();
    expect((await images()).imagesAttempt).toMatchObject({ state: 'waiting' });
    settle.shift()?.(err(SignInTimeout({ provider: CHATGPT_IMAGE_PROVIDER, seconds: 300 })));
    const refused = await again;
    expect(!refused.ok && refused.error.code).toBe('models.sign_in_timeout');
    expect((await images()).imagesAttempt).toMatchObject({
      state: 'failed',
      errorCode: 'models.sign_in_timeout',
    });

    const third = service.signIn({ provider: CHATGPT_IMAGE_PROVIDER });
    await tick();
    settle.shift()?.(connected(CHATGPT_IMAGE_PROVIDER));
    expect(value(await third).chatgpt).toMatchObject({ signedIn: true, imagesSignedIn: true });
    expect((await images()).imagesAttempt).toBeUndefined();
  });

  it('says nothing of a try that was cancelled, or that a newer try replaced', async () => {
    const { service, settle, images } = await setup();
    await service.signIn({ provider: 'openai-codex' });
    const newer = service.signIn({ provider: CHATGPT_IMAGE_PROVIDER });
    await tick();
    // The first try ends as the broker ends a replaced one; the newer one is still in the browser.
    settle.shift()?.(err(CancelledError()));
    await tick();
    expect((await images()).imagesAttempt).toMatchObject({ state: 'waiting' });
    settle.shift()?.(err(CancelledError()));
    await newer;
    expect((await images()).imagesAttempt).toBeUndefined();
  });

  it('forgets how the last try went when the person signs out of the plan', async () => {
    const { service, settle, images } = await setup();
    await service.signIn({ provider: 'openai-codex' });
    settle.shift()?.(err(SignInFailed({ provider: CHATGPT_IMAGE_PROVIDER })));
    await tick();
    expect((await images()).imagesAttempt?.state).toBe('failed');
    const out = value(await service.signOut({ provider: 'openai-codex' }));
    expect(out.chatgpt).toMatchObject({ signedIn: false });
    expect(out.chatgpt.imagesAttempt).toBeUndefined();
  });
});
