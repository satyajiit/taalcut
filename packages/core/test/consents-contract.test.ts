// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The consents contract over a real port: list the standing upload consents,
 * revoke one (idempotent), and a service failure comes back as its error.
 */
import { describe, expect, it } from 'vitest';
import {
  connectRpc,
  consentsContract,
  consentsRouter,
  err,
  fromRpcError,
  ok,
  serveRpc,
  TimeoutError,
  type ConsentsService,
  type UploadConsentInfo,
} from '@taalcut/core';
import { channel } from './helpers/ports';

function serve(service: ConsentsService) {
  const { port1, port2 } = channel();
  serveRpc(consentsRouter(service), port1, { context: {} });
  return connectRpc(consentsContract, port2, { peer: 'agent' }).client;
}

describe('consents contract', () => {
  it('lists the standing consents and revokes one, twice without harm', async () => {
    let consents: UploadConsentInfo[] = [{ module: 'vision', providers: ['google'], grantedAt: 1 }];
    const client = serve({
      list: async () => ok(consents),
      revoke: async ({ module }) => {
        const revoked = consents.some((c) => c.module === module);
        consents = consents.filter((c) => c.module !== module);
        return ok({ module, revoked });
      },
    });
    expect(await client.list()).toEqual([{ module: 'vision', providers: ['google'], grantedAt: 1 }]);
    expect(await client.revoke({ module: 'vision' })).toEqual({ module: 'vision', revoked: true });
    expect(await client.revoke({ module: 'vision' })).toEqual({ module: 'vision', revoked: false });
    expect(await client.list()).toEqual([]);
  });

  it('refuses an empty module, and passes a store failure on as its error', async () => {
    const client = serve({
      list: async () => err(TimeoutError({ ms: 5 })),
      revoke: async ({ module }) => ok({ module, revoked: false }),
    });
    await expect(client.revoke({ module: '' })).rejects.toBeDefined();
    const failed = await client.list().catch((cause: unknown) => fromRpcError(cause));
    expect(failed).toMatchObject({ code: 'core.timeout' });
  });
});
