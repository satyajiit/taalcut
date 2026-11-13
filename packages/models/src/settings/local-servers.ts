// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Bring-your-own local servers under Settings → Advanced (D16): Ollama and LM
 * Studio, off until the user adds one. Taalcut's own runtime needs neither.
 * The base URL is kept through a store (not secret) and registered as a
 * LocalEndpoint on the runtimes that should see it; a test lists the models
 * the server answers with and registers those with their capabilities.
 */
import {
  err,
  LOCAL_SERVER_KINDS,
  ok,
  type AsyncResult,
  type LocalServerCheck,
  type LocalServerKind,
} from '@taalcut/core';
import type { FetchFn } from '../client/http-meter';
import { EndpointHasCredentials, EndpointInvalid, ModelNotConfigured } from '../errors';
import { discoverLocalModels, type DiscoverOptions } from '../runtime/discovery';
import type { LocalEndpoint, LocalModelSpec } from '../runtime/endpoints';
import type { ModelRuntime } from '../runtime/runtime';

export type LocalServerUrls = Partial<Record<LocalServerKind, string>>;

/** Where the servers' base URLs persist. The desktop implements it over the settings store. */
export interface LocalServerStore {
  load(): AsyncResult<LocalServerUrls>;
  save(urls: LocalServerUrls): AsyncResult<void>;
}

export interface LocalServersDeps {
  readonly store?: LocalServerStore;
  /** Runtimes in this process that get the endpoint (another process applies `localServerEndpoint`). */
  readonly runtimes?: readonly ModelRuntime[];
  readonly discover?: (options: DiscoverOptions) => AsyncResult<readonly LocalModelSpec[]>;
  readonly fetch?: FetchFn;
  readonly now: () => number;
}

export interface LocalServers {
  /** Reads the store and registers the saved servers. */
  load(): AsyncResult<void>;
  rows(): { kind: LocalServerKind; baseUrl?: string; lastCheck?: LocalServerCheck }[];
  set(kind: LocalServerKind, baseUrl: string | null): AsyncResult<void>;
  test(kind: LocalServerKind): AsyncResult<LocalServerCheck>;
}

const NAMES: Record<LocalServerKind, string> = { ollama: 'Ollama', 'lm-studio': 'LM Studio' };

/** The OpenAI-compatible base URL, with /v1, that endpoints and discovery expect. */
export function localServerBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

/** The LocalEndpoint for a bring-your-own server; the provider id is the kind ('ollama', 'lm-studio'). */
export function localServerEndpoint(
  kind: LocalServerKind,
  baseUrl: string,
  models: readonly LocalModelSpec[] = [],
): LocalEndpoint {
  // Models the user pulls later still work, with conservative defaults.
  return { id: kind, name: NAMES[kind], baseUrl: localServerBaseUrl(baseUrl), models, acceptUnlisted: true };
}

/**
 * 'credentials' for an address with a user name or password in it: settings aren't a secret store,
 * and the address comes back on the accounts rows.
 */
function checkUrl(value: string): 'ok' | 'invalid' | 'credentials' {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'invalid';
  }
  if (!/^https?:$/.test(url.protocol)) return 'invalid';
  return url.username || url.password ? 'credentials' : 'ok';
}

export function createLocalServers(deps: LocalServersDeps): LocalServers {
  const discover = deps.discover ?? discoverLocalModels;
  let urls: LocalServerUrls = {};
  const models = new Map<LocalServerKind, readonly LocalModelSpec[]>();
  const checks = new Map<LocalServerKind, LocalServerCheck>();

  const apply = (kind: LocalServerKind) => {
    const url = urls[kind];
    for (const runtime of deps.runtimes ?? []) {
      if (url) runtime.setEndpoint(localServerEndpoint(kind, url, models.get(kind)));
      else runtime.removeEndpoint(kind);
    }
  };

  return {
    async load() {
      if (!deps.store) return ok(undefined);
      const loaded = await deps.store.load();
      if (!loaded.ok) return loaded;
      urls = Object.fromEntries(
        LOCAL_SERVER_KINDS.flatMap((kind) => {
          const url = loaded.value[kind];
          return url && checkUrl(url) === 'ok' ? [[kind, url]] : [];
        }),
      );
      for (const kind of LOCAL_SERVER_KINDS) apply(kind);
      // An address saved with a password in it (before addresses were checked) leaves settings now.
      const withCredentials = LOCAL_SERVER_KINDS.some((kind) => {
        const url = loaded.value[kind];
        return url !== undefined && checkUrl(url) === 'credentials';
      });
      return withCredentials ? deps.store.save(urls) : ok(undefined);
    },
    rows: () =>
      LOCAL_SERVER_KINDS.map((kind) => {
        const baseUrl = urls[kind];
        const lastCheck = checks.get(kind);
        return { kind, ...(baseUrl ? { baseUrl } : {}), ...(lastCheck ? { lastCheck } : {}) };
      }),
    async set(kind, baseUrl) {
      const checked = baseUrl === null ? 'ok' : checkUrl(baseUrl);
      if (checked === 'credentials') return err(EndpointHasCredentials({ field: 'baseUrl' }));
      if (checked === 'invalid') return err(EndpointInvalid({ field: 'baseUrl' }));
      const { [kind]: _previous, ...rest } = urls;
      const next: LocalServerUrls = baseUrl === null ? rest : { ...rest, [kind]: baseUrl };
      const saved = deps.store ? await deps.store.save(next) : ok(undefined);
      if (!saved.ok) return saved;
      urls = next;
      models.delete(kind);
      checks.delete(kind);
      apply(kind);
      return ok(undefined);
    },
    async test(kind) {
      const url = urls[kind];
      if (!url) return err(ModelNotConfigured({ provider: kind }));
      const found = await discover({
        baseUrl: localServerBaseUrl(url),
        kind: kind === 'ollama' ? 'ollama' : 'openai-compatible',
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      });
      const check: LocalServerCheck = found.ok
        ? { at: deps.now(), ok: true, models: found.value.length }
        : { at: deps.now(), ok: false, errorCode: found.error.code };
      if (found.ok) {
        models.set(kind, found.value);
        apply(kind);
      }
      checks.set(kind, check);
      return ok(check);
    },
  };
}
