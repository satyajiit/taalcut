// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Review M3: the hub's addresses come from the build, and the environment only where nothing is baked and the app
// isn't a packaged release, so a launcher can't send the keychain install key to an origin it chose.
import { describe, expect, it, vi } from 'vitest';
import { hubEndpoints, hubEndpointsFrom, type HubEndpointSources } from '../src/utility/roots/hub-endpoints';

const NONE = { indexUrl: '', workerUrl: '' };
const BAKED = { indexUrl: 'https://hub.taalcut.dev/v0/index.json', workerUrl: 'https://api.taalcut.dev/' };
const ENV = {
  TAALCUT_HUB_INDEX_URL: 'https://elsewhere.example/v0/index.json',
  TAALCUT_HUB_WORKER_URL: 'https://elsewhere.example/',
};

const from = (overrides: Partial<HubEndpointSources>) =>
  hubEndpointsFrom({ baked: NONE, flavour: 'release', packaged: false, env: {}, ...overrides });

describe('hubEndpointsFrom', () => {
  it('prefers the baked pair over the environment, packaged or not', () => {
    expect(from({ baked: BAKED, env: ENV })).toEqual(BAKED);
    expect(from({ baked: BAKED, env: ENV, packaged: true })).toEqual(BAKED);
  });

  it('reads the environment only when nothing is baked and the app is not a packaged release', () => {
    expect(from({ env: ENV })).toEqual({
      indexUrl: ENV.TAALCUT_HUB_INDEX_URL,
      workerUrl: ENV.TAALCUT_HUB_WORKER_URL,
    });
    expect(from({ env: ENV, packaged: true, flavour: 'test' })?.workerUrl).toBe(ENV.TAALCUT_HUB_WORKER_URL);
    expect(from({ env: ENV, packaged: true })).toBeNull();
  });

  it('needs both addresses, https (loopback http only when a test build baked it)', () => {
    expect(from({ env: { TAALCUT_HUB_INDEX_URL: ENV.TAALCUT_HUB_INDEX_URL } })).toBeNull();
    expect(
      from({ env: { ...ENV, TAALCUT_HUB_WORKER_URL: 'http://127.0.0.1:9/' }, flavour: 'test' }),
    ).toBeNull();
    expect(from({ env: { ...ENV, TAALCUT_HUB_WORKER_URL: 'not a url' } })).toBeNull();
    const loopback = { indexUrl: 'http://127.0.0.1:9/v0/index.json', workerUrl: 'http://localhost:9/' };
    expect(from({ baked: loopback, flavour: 'test' })).toEqual(loopback);
    expect(from({ baked: loopback })).toBeNull();
  });

  it("ignores a packaged release's environment in this unbaked bundle, and reads it unpackaged", () => {
    vi.stubEnv('TAALCUT_HUB_INDEX_URL', ENV.TAALCUT_HUB_INDEX_URL);
    vi.stubEnv('TAALCUT_HUB_WORKER_URL', ENV.TAALCUT_HUB_WORKER_URL);
    try {
      expect(hubEndpoints(true)).toBeNull();
      expect(hubEndpoints(false)?.workerUrl).toBe(ENV.TAALCUT_HUB_WORKER_URL);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
