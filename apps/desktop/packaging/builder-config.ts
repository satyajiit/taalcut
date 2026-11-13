// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The electron-builder configuration (P1-B3, P1-B4, LNX1-PKG), as a function of
 * the environment and the bundle's build settings so test/packaging.test.ts can
 * check it: macOS arm64 DMG and zip, hardened runtime, fuses, ASAR integrity,
 * ad-hoc unless TAALCUT_MAC_IDENTITY names a Developer ID; and a Linux x64 .deb
 * (linux.ts). The fuses are the same on both; Electron checks ASAR integrity on
 * macOS and Windows only, so on Linux that one fuse is set but has no effect.
 *
 * Resources by platform: the phone page, render's fonts and the component
 * manifest everywhere; the macOS FFmpeg, mac helper, CLI, Seatbelt profiles and
 * InfoPlist.strings in mac.extraResources; the Linux FFmpeg in linux's.
 *
 * Signing order (inside-out): afterPack signs the sidecars and checks the mac
 * helper against the pin baked into the bundles (mac-helper.ts); electron-builder
 * (@electron/osx-sign) signs every other nested binary (helpers, frameworks,
 * sqlite-vec) and then the app; afterSign notarises and staples the app;
 * afterAllArtifactBuild signs, notarises and staples the DMG (notarize.ts).
 *
 * Output: release/ for release builds, release/test/ for test builds, so the
 * two can't be mixed up.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Configuration } from 'electron-builder';
import {
  NS_LOCAL_NETWORK_USAGE_DESCRIPTION,
  NS_PHOTO_LIBRARY_USAGE_DESCRIPTION,
} from '../src/main/transfer/local-network-note';
import { NS_MICROPHONE_USAGE_DESCRIPTION } from '../src/main/voice/microphone-note';
import { COMPONENT_MANIFEST_FILE, COMPONENT_MANIFEST_SOURCE } from '../src/shared/component-manifest';
import { APP_FILES } from './app-files';
import { outputDir } from './build-output';
import { readBuildInfo, type BuildSettings } from './build-settings';
import { taalcutCliResources } from './cli-resources';
import { dmgConfig } from './dmg';
import { FUSES } from './fuses';
import { infoPlistResources } from './info-plist-strings';
import { linuxConfig } from './linux';
import { licenceResources, prepareLicenceResources } from './licence-resources';
import { linuxAfterPack } from './linux-after-pack';
import { createDistributionHooks } from './notarize';
import { phoneResources } from './phone-resources';
import { placesResources } from './places-resources';
import { renderResources } from './render-resources';
import { projectExecutionResources } from './project-execution-resources';
import { sandboxResources } from './sandbox-resources';
import {
  checkPackedMacHelper,
  MAC_HELPER_BINARY,
  macHelperEntitlements,
  macHelperResources,
} from './mac-helper';
import { createSidecarSigner, SIDECAR_SIGN_IGNORE, sidecarResources } from './sidecars';
import { AD_HOC, builderIdentity, entitlementsFile, macIdentity } from './signing';

const ICON = join('..', '..', 'design', 'logo', 'kit', 'app-icon', 'macos', 'Taalcut.icns');

/** Test builds publish to a placeholder only so electron-builder writes latest-mac.yml; the test passes the real feed. */
export const TEST_FEED_PLACEHOLDER = 'http://127.0.0.1/taalcut-test-feed/';

/** TAALCUT_APP_VERSION overrides package.json's version in the packaged app (builds N+1 for update tests). */
export function appVersionOverride(env: NodeJS.ProcessEnv): { version: string } | undefined {
  const version = env.TAALCUT_APP_VERSION?.trim();
  if (!version) return undefined;
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error(`TAALCUT_APP_VERSION is not semver: ${version}`);
  return { version };
}

export function builderConfig(
  env: NodeJS.ProcessEnv,
  projectDir: string,
  settings: BuildSettings = readBuildInfo(projectDir),
): Configuration {
  const identity = macIdentity(env);
  const entitlements = entitlementsFile(identity);
  const feed = settings.updateFeedUrl ?? (settings.flavour === 'test' ? TEST_FEED_PLACEHOLDER : undefined);
  const distribution = createDistributionHooks({ env, identity, flavour: settings.flavour });
  const signSidecars = createSidecarSigner({
    identity,
    entitlements: { [MAC_HELPER_BINARY]: macHelperEntitlements(projectDir) },
  });
  return {
    appId: 'com.taalcut.app',
    productName: 'Taalcut',
    copyright: 'Copyright (C) 2026 Taalcut contributors',
    directories: { output: outputDir(settings, env), buildResources: 'packaging' },
    ...(appVersionOverride(env) ? { extraMetadata: appVersionOverride(env) } : {}),
    // The bundles in out/ and the production dependencies, without native ML code (app-files.ts).
    files: [...APP_FILES],
    asar: true,
    // A native library can't be loaded from inside the archive.
    asarUnpack: ['**/node_modules/sqlite-vec-*/**', '**/node_modules/@node-usb/**'],
    electronFuses: FUSES,
    // UI languages for v1 (decision D8); drops the other Chromium locales.
    electronLanguages: ['en', 'hi', 'es', 'pt_BR'],
    npmRebuild: false,
    // A named Developer ID that isn't in the keychain fails the build; electron-builder
    // would otherwise log it and ship an unsigned app.
    forceCodeSigning: identity !== AD_HOC,
    // Every platform's: the phone page, render's fonts, and the signed component manifest the jobs process loads
    // (Resources/manifest.signed.json). Each platform's FFmpeg and native pieces are in its own section.
    extraResources: [
      ...phoneResources(projectDir),
      ...renderResources(projectDir),
      ...projectExecutionResources(projectDir),
      // LIB1-PLACE: GeoNames' cities, for place names on this Mac.
      ...placesResources(projectDir),
      { from: join(projectDir, COMPONENT_MANIFEST_SOURCE), to: COMPONENT_MANIFEST_FILE },
      ...licenceResources(projectDir),
    ],
    mac: {
      extraFiles: [
        { from: join(projectDir, 'packaging/background'), to: 'Library/LaunchAgents', filter: ['*.plist'] },
      ],
      extraResources: [
        {
          from: join(projectDir, 'packaging/background/taalcut-background-wake'),
          to: 'bin/taalcut-background-wake',
        },
        ...sidecarResources(projectDir, env),
        ...macHelperResources(projectDir),
        ...taalcutCliResources(projectDir, env),
        ...sandboxResources(projectDir),
        // The permission prompts in Hindi, Spanish and Brazilian Portuguese (<lproj>/InfoPlist.strings).
        ...infoPlistResources(projectDir),
      ],
      target: [
        { target: 'dmg', arch: ['arm64'] },
        { target: 'zip', arch: ['arm64'] },
      ],
      category: 'public.app-category.video',
      minimumSystemVersion: '14.0',
      ...(existsSync(join(projectDir, ICON)) ? { icon: ICON } : {}),
      identity: builderIdentity(identity),
      hardenedRuntime: true,
      extendInfo: {
        NSLocalNetworkUsageDescription: NS_LOCAL_NETWORK_USAGE_DESCRIPTION,
        NSMicrophoneUsageDescription: NS_MICROPHONE_USAGE_DESCRIPTION,
        NSPhotoLibraryUsageDescription: NS_PHOTO_LIBRARY_USAGE_DESCRIPTION,
      },
      entitlements,
      entitlementsInherit: entitlements,
      // Signed in afterPack with their own (empty) entitlements; see sidecars.ts.
      signIgnore: [SIDECAR_SIGN_IGNORE],
      // notarize.ts notarises with the keychain profile instead.
      notarize: false,
    },
    dmg: dmgConfig(projectDir),
    ...linuxConfig(projectDir),
    // macOS: sidecars signed inside-out, then the packed mac helper checked against the bundles' pin
    // (mac-helper.ts). Linux: modes normalised, the packed FFmpeg checked against media's pin (linux-after-pack.ts).
    // Each returns at once on the other platform.
    afterPack: async (context) => {
      prepareLicenceResources(context);
      await signSidecars(context);
      checkPackedMacHelper(context, settings.macHelperPin);
      await linuxAfterPack(context);
    },
    afterSign: distribution.afterSign,
    afterAllArtifactBuild: distribution.afterAllArtifactBuild,
    // A generic feed makes electron-builder write latest-mac.yml, or <channel>-mac.yml
    // when a channel is baked (P2-X6). One channel file, not every channel.
    publish: feed
      ? [
          {
            provider: 'generic',
            url: feed,
            ...(settings.updateChannel ? { channel: settings.updateChannel } : {}),
          },
        ]
      : null,
  };
}
