// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ConsentRevoked, UploadConsentInfo } from '@taalcut/core';

/**
 * The fake's standing upload consents (appContract.consents, served by the
 * agent in the app): what "Always allow" on a consent card left behind. Starts
 * with two, so Settings → Privacy has a list to show.
 */
export interface FakeConsents {
  list(): UploadConsentInfo[];
  revoke(module: string): ConsentRevoked;
  /** As "Always allow" does: for tests. */
  grant(consent: UploadConsentInfo): void;
}

const DAY = 24 * 60 * 60 * 1000;

export function createFakeConsents(now: () => number, initial?: readonly UploadConsentInfo[]): FakeConsents {
  const consents = new Map<string, UploadConsentInfo>();
  const seed = initial ?? [
    { module: 'vision', providers: ['google'], grantedAt: now() - 2 * DAY },
    { module: 'speech', providers: ['elevenlabs', 'openai'], grantedAt: now() - 9 * DAY },
  ];
  for (const consent of seed) consents.set(consent.module, consent);
  return {
    list: () => [...consents.values()].sort((a, b) => b.grantedAt - a.grantedAt),
    revoke: (module) => ({ module, revoked: consents.delete(module) }),
    grant: (consent) => void consents.set(consent.module, consent),
  };
}
