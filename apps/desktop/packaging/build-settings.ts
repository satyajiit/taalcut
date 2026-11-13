// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings fixed at bundle time and baked into the code, so a packaged app's
 * behaviour can't be changed by its environment (its ASAR is integrity-checked).
 *
 *   TAALCUT_BUILD_FLAVOUR     'release' (default) or 'test'. A test build accepts
 *                             --remote-debugging-port and the test-only switches
 *                             in src/main/test-hooks.ts; a release build has
 *                             neither (the code is removed at bundle time).
 *   TAALCUT_UPDATE_FEED_URL   The one update-feed address (generic provider).
 *                             https only, except loopback http in test builds.
 *                             Hosting (a public releases repo or R2) is undecided;
 *                             this is the only place the URL lives. Unset: no feed.
 *   TAALCUT_UPDATE_PUBLIC_KEY The key every update channel file must be signed with
 *                             (security review SB-19): base64 of the raw 32-byte
 *                             Ed25519 public key (`node scripts/release.mjs keygen`
 *                             prints it). Required in a release build that bakes a
 *                             feed; a release build refuses the e2e test key.
 *   TAALCUT_UPDATE_CHANNEL    internal, alpha, beta or stable. Unset: Phase 1
 *                             latest-mac.yml (no channel). A packaged app cannot
 *                             change this through its environment.
 *   TAALCUT_CRASH_DSN         Opt-in crash ingest (Sentry or GlitchTip). https
 *                             only, except loopback http in test builds. Unset:
 *                             the build cannot report.
 *   TAALCUT_TELEMETRY_URL     Alpha telemetry ingest. https only, except loopback
 *                             http in test builds. Unset: nothing is queued or sent.
 *   TAALCUT_HUB_INDEX_URL     The template hub's index document and its Worker
 *   TAALCUT_HUB_WORKER_URL    (docs/template-hub.md). Both or neither; https only,
 *                             except loopback http in test builds. A Worker write
 *                             carries the keychain install key, so the origin is
 *                             baked, never read from a packaged release's
 *                             environment (review M3). Unset: the hub answers
 *                             hub.not_configured (unpackaged runs may still name
 *                             it through the same variables at run time).
 *   TAALCUT_TEST_UPDATE_FAULT Test builds only: 'exit-before-ready' makes main exit
 *                             right after the update launch check (P3-B9's broken
 *                             build for the rollback e2e). Refused in a release build.
 *
 * One setting comes from the checkout, not the environment: macHelperPin, the
 * signature-free sha256 of native/mac-helper/dist/taalcut-mac-helper when the
 * bundles were built (packaging/mac-helper.ts). It is baked in as
 * __TAALCUT_MAC_HELPER_PIN__, and packaging refuses to ship any other helper.
 *
 * tsdown writes the settings to out/build-info.json, and the packaging config
 * reads them back from there, so a package always matches what was bundled.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UPDATE_CHANNELS, type UpdateChannel } from '@taalcut/core';
import { BUILD_INFO_FILE, type BuildFlavour } from './build-output';

export type { BuildFlavour };

export interface BuildSettings {
  readonly flavour: BuildFlavour;
  readonly updateFeedUrl: string | undefined;
  /** base64 raw Ed25519 public key the channel files are signed with; unset in builds without updates. */
  readonly updatePublicKey?: string;
  /** Unset keeps the Phase 1 feed file (latest-mac.yml). */
  readonly updateChannel: UpdateChannel | undefined;
  readonly crashDsn: string | undefined;
  readonly telemetryUrl: string | undefined;
  /** The template hub's index document and Worker origin; both or neither. */
  readonly hub?: HubAddresses;
  /** Test builds only (the rollback e2e's broken build); absent otherwise. */
  readonly testUpdateFault?: TestUpdateFault;
  /** The mac helper the bundles were built with (packaging/mac-helper.ts); absent when the checkout had none. */
  readonly macHelperPin?: string;
}

export interface HubAddresses {
  readonly indexUrl: string;
  readonly workerUrl: string;
}

export const TEST_UPDATE_FAULTS = ['exit-before-ready'] as const;
export type TestUpdateFault = (typeof TEST_UPDATE_FAULTS)[number];

export { BUILD_INFO_FILE };

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The packaged update e2e's public key (scripts/rollout/manifest-signature.ts testSigningKey; its private half is
 * derived from a public string). A release build that trusted it would accept channel files anyone can sign.
 */
export const TEST_UPDATE_PUBLIC_KEY = 'bO2drZzwnnMDdvBYs1HBdAELrJ31z8kBnolZ8LyGNsQ=';

export function buildSettingsFromEnv(env: NodeJS.ProcessEnv): BuildSettings {
  const flavourValue = env.TAALCUT_BUILD_FLAVOUR?.trim() || 'release';
  if (flavourValue !== 'release' && flavourValue !== 'test') {
    throw new Error(`TAALCUT_BUILD_FLAVOUR must be 'release' or 'test', got '${flavourValue}'`);
  }
  const flavour: BuildFlavour = flavourValue;
  const feed = env.TAALCUT_UPDATE_FEED_URL?.trim() || undefined;
  if (feed !== undefined) checkFeedUrl(feed, flavour);
  const updatePublicKey = parsePublicKey(env.TAALCUT_UPDATE_PUBLIC_KEY, flavour, feed);
  const updateChannel = parseChannel(env.TAALCUT_UPDATE_CHANNEL);
  const crashDsn = optionalHttps(env.TAALCUT_CRASH_DSN, flavour, 'Crash DSN');
  const telemetryUrl = optionalHttps(env.TAALCUT_TELEMETRY_URL, flavour, 'Telemetry URL');
  const testUpdateFault = parseTestFault(env.TAALCUT_TEST_UPDATE_FAULT, flavour);
  const hub = parseHub(env.TAALCUT_HUB_INDEX_URL, env.TAALCUT_HUB_WORKER_URL, flavour);
  return {
    flavour,
    updateFeedUrl: feed,
    ...(updatePublicKey ? { updatePublicKey } : {}),
    updateChannel,
    crashDsn,
    telemetryUrl,
    ...(hub ? { hub } : {}),
    ...(testUpdateFault ? { testUpdateFault } : {}),
  };
}

/** Both hub addresses or neither: one alone would be a hub that can read but not write, or the reverse. */
function parseHub(
  index: string | undefined,
  worker: string | undefined,
  flavour: BuildFlavour,
): HubAddresses | undefined {
  const indexUrl = optionalHttps(index, flavour, 'Hub index URL');
  const workerUrl = optionalHttps(worker, flavour, 'Hub Worker URL');
  if (indexUrl === undefined && workerUrl === undefined) return undefined;
  if (indexUrl === undefined || workerUrl === undefined)
    throw new Error('TAALCUT_HUB_INDEX_URL and TAALCUT_HUB_WORKER_URL are set together or not at all');
  return { indexUrl, workerUrl };
}

/** `value`, trimmed, when it is one of `allowed`; undefined when unset; anything else throws. */
function optionalMember<T extends string>(
  name: string,
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  const trimmed = value?.trim() || undefined;
  if (trimmed === undefined) return undefined;
  const found = allowed.find((candidate) => candidate === trimmed);
  if (found === undefined) throw new Error(`${name} must be one of ${allowed.join(', ')}, got '${trimmed}'`);
  return found;
}

function parseTestFault(value: string | undefined, flavour: BuildFlavour): TestUpdateFault | undefined {
  if (value?.trim() && flavour !== 'test')
    throw new Error('TAALCUT_TEST_UPDATE_FAULT is for test builds only');
  return optionalMember('TAALCUT_TEST_UPDATE_FAULT', value, TEST_UPDATE_FAULTS);
}

/** A release build with a feed must name the key its channel files are signed with, and never the test key. */
function parsePublicKey(
  value: string | undefined,
  flavour: BuildFlavour,
  feed: string | undefined,
): string | undefined {
  const key = value?.trim() || undefined;
  if (key === undefined) {
    if (flavour === 'release' && feed !== undefined) {
      throw new Error(
        'TAALCUT_UPDATE_PUBLIC_KEY is required with TAALCUT_UPDATE_FEED_URL: channel files are signed',
      );
    }
    return undefined;
  }
  const raw = Buffer.from(key, 'base64');
  if (raw.length !== 32 || raw.toString('base64') !== key) {
    throw new Error('TAALCUT_UPDATE_PUBLIC_KEY must be base64 of a raw 32-byte Ed25519 public key');
  }
  if (flavour === 'release' && key === TEST_UPDATE_PUBLIC_KEY) {
    throw new Error('TAALCUT_UPDATE_PUBLIC_KEY is the e2e test key: release builds never trust it');
  }
  return key;
}

function parseChannel(value: string | undefined): UpdateChannel | undefined {
  return optionalMember('TAALCUT_UPDATE_CHANNEL', value, UPDATE_CHANNELS);
}

/** Unset stays unset. https, or loopback http in a test build. */
function optionalHttps(value: string | undefined, flavour: BuildFlavour, label: string): string | undefined {
  const trimmed = value?.trim() || undefined;
  if (trimmed === undefined) return undefined;
  checkBakedUrl(trimmed, flavour, label);
  return trimmed;
}

/** Throws unless the feed is https, or loopback http in a test build. */
export function checkFeedUrl(value: string, flavour: BuildFlavour): void {
  checkBakedUrl(value, flavour, 'Update feed');
}

/** Throws unless the address is https, or loopback http in a test build. */
export function checkBakedUrl(value: string, flavour: BuildFlavour, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not a URL: ${value}`);
  }
  const loopbackHttp = url.protocol === 'http:' && LOOPBACK.has(url.hostname);
  if (url.protocol !== 'https:' && !(flavour === 'test' && loopbackHttp)) {
    throw new Error(`${label} must be https (loopback http only in test builds): ${value}`);
  }
}

/** Global constants replaced in the bundles (declared in src/build-constants.d.ts). */
export function bundleDefines(settings: BuildSettings): Record<string, string> {
  return {
    __TAALCUT_FLAVOUR__: JSON.stringify(settings.flavour),
    __TAALCUT_UPDATE_FEED__: JSON.stringify(settings.updateFeedUrl ?? ''),
    __TAALCUT_UPDATE_CHANNEL__: JSON.stringify(settings.updateChannel ?? ''),
    __TAALCUT_UPDATE_PUBLIC_KEY__: JSON.stringify(settings.updatePublicKey ?? ''),
    __TAALCUT_CRASH_DSN__: JSON.stringify(settings.crashDsn ?? ''),
    __TAALCUT_TELEMETRY_URL__: JSON.stringify(settings.telemetryUrl ?? ''),
    __TAALCUT_HUB_INDEX_URL__: JSON.stringify(settings.hub?.indexUrl ?? ''),
    __TAALCUT_HUB_WORKER_URL__: JSON.stringify(settings.hub?.workerUrl ?? ''),
    __TAALCUT_TEST_UPDATE_FAULT__: JSON.stringify(settings.testUpdateFault ?? ''),
    __TAALCUT_MAC_HELPER_PIN__: JSON.stringify(settings.macHelperPin ?? ''),
  };
}

export function writeBuildInfo(projectDir: string, settings: BuildSettings): void {
  writeFileSync(join(projectDir, BUILD_INFO_FILE), `${JSON.stringify(settings, null, 2)}\n`);
}

export function readBuildInfo(projectDir: string): BuildSettings {
  const file = join(projectDir, BUILD_INFO_FILE);
  if (!existsSync(file)) throw new Error(`${file} not found: run the desktop build before packaging.`);
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<BuildSettings>;
  const fromEnv = buildSettingsFromEnv({
    TAALCUT_BUILD_FLAVOUR: parsed.flavour,
    TAALCUT_UPDATE_FEED_URL: parsed.updateFeedUrl,
    TAALCUT_UPDATE_CHANNEL: parsed.updateChannel,
    TAALCUT_UPDATE_PUBLIC_KEY: parsed.updatePublicKey,
    TAALCUT_CRASH_DSN: parsed.crashDsn,
    TAALCUT_TELEMETRY_URL: parsed.telemetryUrl,
    TAALCUT_HUB_INDEX_URL: parsed.hub?.indexUrl,
    TAALCUT_HUB_WORKER_URL: parsed.hub?.workerUrl,
    TAALCUT_TEST_UPDATE_FAULT: parsed.testUpdateFault,
  });
  const pin = parsed.macHelperPin;
  if (pin === undefined) return fromEnv;
  if (typeof pin !== 'string' || !/^[0-9a-f]{64}$/.test(pin))
    throw new Error(`${file}: macHelperPin must be a sha256 in hex`);
  return { ...fromEnv, macHelperPin: pin };
}
