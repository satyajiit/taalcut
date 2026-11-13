// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's Instagram sign-in (REF1): it records the Instagram warning the person accepted, and nothing else. Before
 * REF1 it also recorded the reel-download warning silently; that warning is gone.
 */
import { describe, expect, it, vi } from 'vitest';
import { INSTAGRAM_WARNING, ok, REFERENCE_DOWNLOAD_WARNING, type AcknowledgementStore } from '@taalcut/core';
import { createMainInstagramAuth } from '../src/main/instagram/instagram-login';

vi.mock('electron', () => ({ BrowserWindow: class {}, session: { fromPartition: () => undefined } }));

function memoryAcknowledgements() {
  const records: { featureId: string; termsVersion: string; acknowledgedAt: number }[] = [];
  const store: AcknowledgementStore = {
    has: async (featureId, termsVersion) =>
      ok(records.some((r) => r.featureId === featureId && r.termsVersion === termsVersion)),
    latest: async (featureId) => ok(records.filter((r) => r.featureId === featureId).at(-1) ?? null),
    record: async ({ featureId, termsVersion, at }) => {
      const record = { featureId, termsVersion, acknowledgedAt: at ?? 1 };
      records.push(record);
      return ok(record);
    },
  } as AcknowledgementStore;
  return { store, records };
}

describe('Instagram sign-in', () => {
  it('records the Instagram warning and no download warning', async () => {
    const { store, records } = memoryAcknowledgements();
    const secrets = new Map<string, string>();
    const auth = createMainInstagramAuth({
      secrets: {
        get: async (key) => ok(secrets.get(key)),
        set: async (key, value) => (secrets.set(key, value), ok(undefined)),
        delete: async (key) => (secrets.delete(key), ok(undefined)),
      },
      acknowledgements: store,
      openLoginWindow: async () =>
        ok({ sessionId: 'EXAMPLE', csrfToken: 'EXAMPLE', dsUserId: '1', createdAt: 1 }),
    });
    expect((await auth.signIn({ acknowledgedAt: 1_000 })).ok).toBe(true);
    expect(records.map((r) => r.featureId)).toEqual([INSTAGRAM_WARNING.feature]);
    expect(records.map((r) => r.featureId)).not.toContain(REFERENCE_DOWNLOAD_WARNING.featureId);
    expect((await auth.status()).ok && (await auth.status())).toMatchObject({
      ok: true,
      value: { signedIn: true, acknowledgedAt: 1_000 },
    });
  });
});
