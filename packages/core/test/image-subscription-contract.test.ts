// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  accountsContract,
  accountsStateSchema,
  CHATGPT_IMAGE_PROVIDER,
  CHATGPT_PROVIDER,
  generatedProvenanceSchema,
} from '@taalcut/core';
import { inputOf } from './helpers/phase3';

describe('image subscription contracts', () => {
  it('keeps image sign-in distinct from the existing chat connection', () => {
    expect(CHATGPT_IMAGE_PROVIDER).not.toBe(CHATGPT_PROVIDER);
    expect(inputOf(accountsContract.signIn, { provider: CHATGPT_IMAGE_PROVIDER }).success).toBe(true);
    expect(inputOf(accountsContract.signIn, { provider: CHATGPT_PROVIDER }).success).toBe(true);
    const state = {
      chatgpt: { signedIn: true, manageUsageUrl: 'https://chatgpt.com/settings/usage' },
      subscriptions: [],
      apiKeys: [],
      localServers: [],
    };
    expect(accountsStateSchema.parse(state).chatgpt.imagesSignedIn).toBeUndefined();
    expect(
      accountsStateSchema.parse({ ...state, chatgpt: { ...state.chatgpt, imagesSignedIn: false } }).chatgpt,
    ).toMatchObject({ signedIn: true, imagesSignedIn: false });
  });

  it('preserves subscription access on generated assets without treating quota as API spend', () => {
    const provenance = generatedProvenanceSchema.parse({
      kind: 'generated',
      generation: 'image',
      provider: CHATGPT_IMAGE_PROVIDER,
      model: 'gpt-image-2',
      access: 'subscription',
      quality: null,
      promptSha256: 'a'.repeat(64),
      voiceId: null,
      providerRef: null,
      c2pa: 'unknown',
      costUsd: 0,
      runId: null,
      createdAt: 0,
    });
    expect(provenance.access).toBe('subscription');
    expect(provenance.costUsd).toBe(0);
  });
});
