// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HTTP and credential ports for library stock. The key is asked of main's
 * AuthBroker for that one search. It is not logged, not put on an error and
 * not written to sqlite. Import does not read the key: the command enqueues
 * `library.stockImport` and the jobs process streams the cached rendition to
 * disk with the same HTTP port. `app://media/stock/…` is not served here.
 */
import {
  callRpc,
  ok,
  type AsyncResult,
  type Container,
  type MainServicesClient,
  type StockProviderId,
} from '@taalcut/core';
import { createFetchStockHttp, readLocalOnly, type LibraryServiceDeps } from '@taalcut/library';
import { AgentMainServicesToken, LibraryDatabaseToken } from '../../shared/tokens';

type Main = () => MainServicesClient<'agent'>;

export function libraryStockPorts(
  container: Container,
): Pick<LibraryServiceDeps, 'http' | 'credentials' | 'localOnly'> {
  const db = container.resolve(LibraryDatabaseToken);
  const main: Main | undefined = container.has(AgentMainServicesToken)
    ? container.resolve(AgentMainServicesToken)
    : undefined;
  return {
    http: createFetchStockHttp(),
    credentials: { get: (provider) => stockKey(main, provider) },
    localOnly: () => readLocalOnly(db),
  };
}

/**
 * The user's key for one search. Not set up (null, `none`, an empty secret) is
 * "no key", which search shows as the paused-keys state. A failed call to main
 * is an error: telling the user to add a key they already have would be wrong.
 */
async function stockKey(main: Main | undefined, provider: StockProviderId): AsyncResult<string | null> {
  // The jobs process has no port to main and never searches.
  if (!main) return ok(null);
  const resolved = await callRpc(main().credentials.get({ provider }));
  if (!resolved.ok) return resolved;
  const credential = resolved.value;
  if (credential === null || credential.kind === 'none') return ok(null);
  const secret = credential.secret ?? '';
  return ok(secret.length > 0 ? secret : null);
}
