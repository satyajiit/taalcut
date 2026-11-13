// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where the hub lives (P3-B12, review M3). A Worker write sends the keychain install key to `workerUrl`, so the
 * origin is fixed when the app is bundled (packaging/build-settings.ts), the way the update feed is: a packaged
 * release reads only the baked pair, and main refuses to start one whose launcher set either variable
 * (security/switches.ts). The variables are for unpackaged runs and test builds, which have no baked pair.
 * Nothing usable is `null`: an unconfigured build (`hub.not_configured`).
 */
import type { HubEndpoints } from '@taalcut/templates';

export const HUB_ENDPOINT_ENV = {
  index: 'TAALCUT_HUB_INDEX_URL',
  worker: 'TAALCUT_HUB_WORKER_URL',
} as const;

export interface HubEndpointSources {
  /** The pair baked into this build, '' each when none was. */
  readonly baked: { readonly indexUrl: string; readonly workerUrl: string };
  readonly flavour: 'release' | 'test';
  /** A packaged app: the environment is never read for a release. */
  readonly packaged: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** https, or loopback http in a test build; the URL normalised, or null. */
function hubOrigin(value: string | undefined, flavour: HubEndpointSources['flavour']): string | null {
  const text = value?.trim();
  if (!text || !URL.canParse(text)) return null;
  const url = new URL(text);
  const loopbackHttp = url.protocol === 'http:' && LOOPBACK.has(url.hostname);
  return url.protocol === 'https:' || (flavour === 'test' && loopbackHttp) ? url.toString() : null;
}

function pair(indexUrl: string | null, workerUrl: string | null): HubEndpoints | null {
  return indexUrl && workerUrl ? { indexUrl, workerUrl } : null;
}

/** The baked pair when this build has one; else the environment's, unless this is a packaged release. */
export function hubEndpointsFrom(sources: HubEndpointSources): HubEndpoints | null {
  const { baked, flavour } = sources;
  if (baked.indexUrl || baked.workerUrl)
    return pair(hubOrigin(baked.indexUrl, flavour), hubOrigin(baked.workerUrl, flavour));
  if (sources.packaged && flavour === 'release') return null;
  // The environment never gets the test build's loopback allowance: only a baked address does.
  return pair(
    hubOrigin(sources.env[HUB_ENDPOINT_ENV.index], 'release'),
    hubOrigin(sources.env[HUB_ENDPOINT_ENV.worker], 'release'),
  );
}

/** This process's hub addresses. */
export function hubEndpoints(packaged: boolean): HubEndpoints | null {
  return hubEndpointsFrom({
    baked: { indexUrl: __TAALCUT_HUB_INDEX_URL__, workerUrl: __TAALCUT_HUB_WORKER_URL__ },
    flavour: __TAALCUT_FLAVOUR__,
    packaged,
    env: process.env,
  });
}
