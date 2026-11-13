// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSettingsFromEnv,
  bundleDefines,
  checkFeedUrl,
  readBuildInfo,
  TEST_UPDATE_PUBLIC_KEY,
  writeBuildInfo,
} from '../packaging/build-settings';

const rawPublicKey = (key: Parameters<typeof createPublicKey>[0]) => {
  const x = createPublicKey(key).export({ format: 'jwk' }).x ?? '';
  return Buffer.from(x, 'base64url').toString('base64');
};
const KEY = rawPublicKey(generateKeyPairSync('ed25519').privateKey);

const unset = {
  updateFeedUrl: undefined,
  updateChannel: undefined,
  crashDsn: undefined,
  telemetryUrl: undefined,
};

describe('buildSettingsFromEnv', () => {
  it('defaults to a release build with no update feed, channel, crash DSN or telemetry URL', () => {
    expect(buildSettingsFromEnv({})).toEqual({ flavour: 'release', ...unset });
    expect(buildSettingsFromEnv({ TAALCUT_BUILD_FLAVOUR: '  ' })).toEqual({
      flavour: 'release',
      ...unset,
    });
  });

  it('accepts a test build and refuses anything else', () => {
    expect(buildSettingsFromEnv({ TAALCUT_BUILD_FLAVOUR: 'test' }).flavour).toBe('test');
    expect(() => buildSettingsFromEnv({ TAALCUT_BUILD_FLAVOUR: 'debug' })).toThrow(/'release' or 'test'/);
  });

  it('takes an https feed in any build, loopback http only in test builds', () => {
    const https = 'https://updates.taalcut.dev/dev/';
    const env = { TAALCUT_UPDATE_FEED_URL: https, TAALCUT_UPDATE_PUBLIC_KEY: KEY };
    expect(buildSettingsFromEnv(env).updateFeedUrl).toBe(https);
    expect(() => checkFeedUrl('http://127.0.0.1:8080/', 'release')).toThrow(/https/);
    expect(() => checkFeedUrl('http://127.0.0.1:8080/', 'test')).not.toThrow();
    expect(() => checkFeedUrl('http://updates.example.com/', 'test')).toThrow(/https/);
    expect(() => checkFeedUrl('ftp://127.0.0.1/', 'test')).toThrow();
    expect(() => checkFeedUrl('not a url', 'test')).toThrow(/not a URL/);
  });
});

describe('the update manifest key (SB-19)', () => {
  const feed = 'https://updates.taalcut.dev/dev/';

  it('is required in a release build with a feed, and baked in', () => {
    expect(() => buildSettingsFromEnv({ TAALCUT_UPDATE_FEED_URL: feed })).toThrow(
      /TAALCUT_UPDATE_PUBLIC_KEY is required/,
    );
    const settings = buildSettingsFromEnv({
      TAALCUT_UPDATE_FEED_URL: feed,
      TAALCUT_UPDATE_PUBLIC_KEY: ` ${KEY} `,
    });
    expect(settings.updatePublicKey).toBe(KEY);
    expect(bundleDefines(settings).__TAALCUT_UPDATE_PUBLIC_KEY__).toBe(JSON.stringify(KEY));
    // No feed, no updates: no key needed.
    expect(buildSettingsFromEnv({}).updatePublicKey).toBeUndefined();
  });

  it('must be 32 bytes of plain base64', () => {
    for (const bad of [
      'abc',
      Buffer.alloc(31).toString('base64'),
      `${KEY.slice(0, -1)}A`,
      'not base64 at all!',
    ]) {
      expect(
        () => buildSettingsFromEnv({ TAALCUT_BUILD_FLAVOUR: 'test', TAALCUT_UPDATE_PUBLIC_KEY: bad }),
        bad,
      ).toThrow(/raw 32-byte/);
    }
  });

  it('is never the e2e test key in a release build; test builds take it', () => {
    // The same derivation as scripts/rollout/manifest-signature.ts testSigningKey (both pin this value).
    const seed = createHash('sha256').update('taalcut update manifest test key: test builds only').digest();
    const prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
    const testKey = createPrivateKey({ key: Buffer.concat([prefix, seed]), format: 'der', type: 'pkcs8' });
    expect(rawPublicKey(testKey)).toBe(TEST_UPDATE_PUBLIC_KEY);
    expect(() =>
      buildSettingsFromEnv({
        TAALCUT_UPDATE_FEED_URL: feed,
        TAALCUT_UPDATE_PUBLIC_KEY: TEST_UPDATE_PUBLIC_KEY,
      }),
    ).toThrow(/test key/);
    const test = buildSettingsFromEnv({
      TAALCUT_BUILD_FLAVOUR: 'test',
      TAALCUT_UPDATE_PUBLIC_KEY: TEST_UPDATE_PUBLIC_KEY,
    });
    expect(test.updatePublicKey).toBe(TEST_UPDATE_PUBLIC_KEY);
  });
});

describe('the hub addresses (review M3)', () => {
  const hub = { indexUrl: 'https://hub.taalcut.dev/v0/index.json', workerUrl: 'https://api.taalcut.dev/' };
  const env = { TAALCUT_HUB_INDEX_URL: hub.indexUrl, TAALCUT_HUB_WORKER_URL: hub.workerUrl };

  it('are baked into the bundle as a pair', () => {
    const settings = buildSettingsFromEnv(env);
    expect(settings.hub).toEqual(hub);
    expect(bundleDefines(settings).__TAALCUT_HUB_INDEX_URL__).toBe(JSON.stringify(hub.indexUrl));
    expect(bundleDefines(settings).__TAALCUT_HUB_WORKER_URL__).toBe(JSON.stringify(hub.workerUrl));
    expect(buildSettingsFromEnv({}).hub).toBeUndefined();
  });

  it('are both set or neither', () => {
    expect(() => buildSettingsFromEnv({ TAALCUT_HUB_INDEX_URL: hub.indexUrl })).toThrow(/together/);
    expect(() => buildSettingsFromEnv({ TAALCUT_HUB_WORKER_URL: hub.workerUrl })).toThrow(/together/);
  });

  it('are https, or loopback http in a test build only', () => {
    const loopback = {
      TAALCUT_HUB_INDEX_URL: 'http://127.0.0.1:9/i.json',
      TAALCUT_HUB_WORKER_URL: 'http://localhost:9/',
    };
    expect(() => buildSettingsFromEnv(loopback)).toThrow(/Hub index URL must be https/);
    expect(buildSettingsFromEnv({ ...loopback, TAALCUT_BUILD_FLAVOUR: 'test' }).hub?.workerUrl).toBe(
      'http://localhost:9/',
    );
    expect(() =>
      buildSettingsFromEnv({
        ...env,
        TAALCUT_HUB_WORKER_URL: 'http://api.example.com/',
        TAALCUT_BUILD_FLAVOUR: 'test',
      }),
    ).toThrow(/Hub Worker URL must be https/);
  });
});

describe('bundle defines and build-info.json', () => {
  it('bakes the flavour and feed in as string literals', () => {
    expect(bundleDefines({ flavour: 'release', ...unset })).toEqual({
      __TAALCUT_FLAVOUR__: '"release"',
      __TAALCUT_UPDATE_FEED__: '""',
      __TAALCUT_UPDATE_CHANNEL__: '""',
      __TAALCUT_UPDATE_PUBLIC_KEY__: '""',
      __TAALCUT_CRASH_DSN__: '""',
      __TAALCUT_TELEMETRY_URL__: '""',
      __TAALCUT_HUB_INDEX_URL__: '""',
      __TAALCUT_HUB_WORKER_URL__: '""',
      __TAALCUT_TEST_UPDATE_FAULT__: '""',
      __TAALCUT_MAC_HELPER_PIN__: '""',
    });
    const baked = bundleDefines({ flavour: 'test', ...unset, updateFeedUrl: 'https://u.example/' });
    expect(baked.__TAALCUT_UPDATE_FEED__).toBe('"https://u.example/"');
  });

  it('takes the rollback e2e fault only in a test build, and only a known one', () => {
    expect(buildSettingsFromEnv({ TAALCUT_BUILD_FLAVOUR: 'test' }).testUpdateFault).toBeUndefined();
    const broken = buildSettingsFromEnv({
      TAALCUT_BUILD_FLAVOUR: 'test',
      TAALCUT_TEST_UPDATE_FAULT: 'exit-before-ready',
    });
    expect(broken.testUpdateFault).toBe('exit-before-ready');
    expect(bundleDefines(broken).__TAALCUT_TEST_UPDATE_FAULT__).toBe('"exit-before-ready"');
    expect(() => buildSettingsFromEnv({ TAALCUT_TEST_UPDATE_FAULT: 'exit-before-ready' })).toThrow(
      /test builds only/,
    );
    expect(() =>
      buildSettingsFromEnv({ TAALCUT_BUILD_FLAVOUR: 'test', TAALCUT_TEST_UPDATE_FAULT: 'crash-later' }),
    ).toThrow(/must be one of/);
  });

  it('round-trips through out/build-info.json, which packaging requires', () => {
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-build-info-'));
    try {
      expect(() => readBuildInfo(dir)).toThrow(/run the desktop build/);
      mkdirSync(join(dir, 'out'));
      writeBuildInfo(dir, { flavour: 'test', ...unset, updateFeedUrl: 'http://127.0.0.1:9/' });
      expect(readBuildInfo(dir)).toEqual({ flavour: 'test', ...unset, updateFeedUrl: 'http://127.0.0.1:9/' });
      writeBuildInfo(dir, {
        flavour: 'release',
        ...unset,
        updateFeedUrl: 'https://u.example/',
        updatePublicKey: KEY,
      });
      expect(readBuildInfo(dir).updatePublicKey).toBe(KEY);
      writeBuildInfo(dir, { flavour: 'test', ...unset, testUpdateFault: 'exit-before-ready' });
      expect(readBuildInfo(dir).testUpdateFault).toBe('exit-before-ready');
      const hub = { indexUrl: 'https://hub.example/v0/index.json', workerUrl: 'https://api.example/' };
      writeBuildInfo(dir, { flavour: 'release', ...unset, hub });
      expect(readBuildInfo(dir)).toEqual({ flavour: 'release', ...unset, hub });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bakes in the mac helper's pin, and packaging reads back only a sha256", () => {
    const pin = 'ab'.repeat(32);
    expect(
      bundleDefines({ flavour: 'release', ...unset, macHelperPin: pin }).__TAALCUT_MAC_HELPER_PIN__,
    ).toBe(JSON.stringify(pin));
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-build-info-'));
    try {
      mkdirSync(join(dir, 'out'));
      writeBuildInfo(dir, { flavour: 'release', ...unset, macHelperPin: pin });
      expect(readBuildInfo(dir)).toEqual({ flavour: 'release', ...unset, macHelperPin: pin });
      writeBuildInfo(dir, { flavour: 'release', ...unset, macHelperPin: 'AB'.repeat(32) });
      expect(() => readBuildInfo(dir)).toThrow(/macHelperPin must be a sha256 in hex/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
