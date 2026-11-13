// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2 eyes: the person's frames go to the agent's model as pictures (video.compare's draft column,
 * timeline.captureFrame, library.frameAt) only on this Mac or under their standing upload consent for the agent's
 * module, read for every call: HFW1-DSN's rule for the make's frame checks. Nobody is asked mid-make.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryConsentStore } from '@taalcut/agent';
import { createContainer } from '@taalcut/core';
import { ConsentStoreToken } from '../src/utility/roots/agent-consent-token';
import { footagePicturesOf } from '../src/utility/roots/agent-eyes';
import { LocalOnlyFlagToken } from '../src/utility/roots/agent-local-only-flag';

function world(localOnly = false) {
  const consents = createMemoryConsentStore();
  const container = createContainer()
    .value(ConsentStoreToken, consents)
    .value(LocalOnlyFlagToken, { get: () => localOnly, refresh: async () => undefined });
  return { consents, rule: footagePicturesOf(container) };
}

describe('the eyes’ pictures rule', () => {
  it('keeps the person’s frames here without a standing consent, and shows them under one, read each call', async () => {
    const { consents, rule } = world();
    // Without the model profiles to read, the chain's cloud provider is unknown: no consent covers it but one for it.
    expect(await rule()).toMatchObject({ shown: false, why: expect.stringContaining('No standing upload consent') });
    await consents.grant({ id: 'c1', module: 'agent', providers: ['unknown'], grantedAt: 1 });
    expect(await rule()).toMatchObject({ shown: true, why: expect.stringContaining('standing upload consent') });
    await consents.revoke('agent');
    expect((await rule()).shown).toBe(false);
  });

  it('shows them under Local only: nothing leaves this Mac', async () => {
    expect(await world(true).rule()).toMatchObject({ shown: true, why: expect.stringContaining('On this Mac') });
  });
});
