// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { FuseV1Options } from '@electron/fuses';
import { describe, expect, it } from 'vitest';
import { builderConfig, TEST_FEED_PLACEHOLDER } from '../packaging/builder-config';
import { EXPECTED_FUSE_WIRE, FUSES } from '../packaging/fuses';
import {
  AD_HOC,
  assertAdHocIsSafe,
  builderIdentity,
  codesignArgs,
  entitlementsFile,
  macIdentity,
  teamIdOf,
} from '../packaging/signing';

const desktopDir = join(import.meta.dirname, '..');
const DEVELOPER_ID = 'Developer ID Application: Matterward Labs Private Limited (WW382UC8JD)';

describe('fuses (PRD 6.4)', () => {
  it('turns off RunAsNode, NODE_OPTIONS and --inspect, and on cookie encryption, ASAR integrity and asar-only', () => {
    expect(FUSES).toEqual({
      runAsNode: false,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      loadBrowserProcessSpecificV8Snapshot: false,
      grantFileProtocolExtraPrivileges: false,
    });
  });

  it('has an expected value for every fuse the installed Electron supports', () => {
    const indexes = Object.values(FuseV1Options).filter((value) => typeof value === 'number');
    expect(Object.keys(EXPECTED_FUSE_WIRE).map(Number).sort()).toEqual([...indexes].sort());
  });
});

describe('builderConfig', () => {
  const release = {
    flavour: 'release',
    updateFeedUrl: undefined,
    updateChannel: undefined,
    crashDsn: undefined,
    telemetryUrl: undefined,
  } as const;
  const testBuild = {
    flavour: 'test',
    updateFeedUrl: undefined,
    updateChannel: undefined,
    crashDsn: undefined,
    telemetryUrl: undefined,
  } as const;
  const config = builderConfig({}, desktopDir, release);

  it('builds Taalcut for macOS arm64 as DMG and zip, with hardened runtime and fuses', () => {
    expect(config).toMatchObject({
      appId: 'com.taalcut.app',
      productName: 'Taalcut',
      asar: true,
      electronFuses: FUSES,
    });
    expect(config.mac?.target).toEqual([
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ]);
    expect(config.mac).toMatchObject({
      hardenedRuntime: true,
      notarize: false,
      minimumSystemVersion: '14.0',
      extendInfo: {
        NSLocalNetworkUsageDescription: expect.stringContaining('Wi-Fi'),
        NSMicrophoneUsageDescription: expect.stringContaining('consent line'),
        NSPhotoLibraryUsageDescription:
          'Taalcut reads the photos and videos you choose from Apple Photos or a connected iPhone or iPad. Your originals stay unchanged.',
      },
    });
    expect(config.disableAsarIntegrity).toBeUndefined();
  });

  it('ships the bundles without source maps, with sqlite-vec unpacked from the ASAR', () => {
    expect(config.files).toEqual(expect.arrayContaining(['out/**/*', '!out/**/*.map', 'package.json']));
    // No native ONNX Runtime and no browser runtime in the app: the binding is a signed component.
    expect(config.files).toEqual(
      expect.arrayContaining([
        '!**/node_modules/onnxruntime-node/bin/**',
        '!**/node_modules/onnxruntime-web/**',
      ]),
    );
    expect(config.asarUnpack).toEqual(['**/node_modules/sqlite-vec-*/**', '**/node_modules/@node-usb/**']);
    expect(config.extraResources).toEqual(
      expect.arrayContaining([
        {
          from: join(desktopDir, '../../tools/ffmpeg/source-distribution.json'),
          to: 'bin/source-distribution.json',
        },
        { from: join(desktopDir, '../../LICENSE-EXCEPTIONS.md'), to: 'licences/LICENSE-EXCEPTIONS.md' },
      ]),
    );
  });

  it('ships readable vendor terms and pins the GSAP text to the installed dependency version', () => {
    const resources = config.extraResources as { from: string; to: string }[];
    for (const [name, text] of [
      ['page-mascot-LICENSE', 'Kamran Ahmed'],
      ['earshot-LICENSE', 'Leon Lin'],
      ['earshot-NOTICE', 'earshot 0.4.0'],
      ['signalsmith-stretch-LICENSE.txt', 'Geraint Luff'],
      ['signalsmith-linear-LICENSE.txt', 'Signalsmith Audio'],
      ['FluidAudio-Apache-2.0.txt', 'Apache License'],
      ['FluidAudio-fastcluster-LICENSE.txt', 'Daniel Müllner'],
      ['GSAP-standard-license.txt', 'VI. MISCELLANEOUS PROVISIONS'],
    ]) {
      const entry = resources.find((resource) => resource.to === `licences/${name}`);
      expect(entry, name).toBeDefined();
      expect(readFileSync(entry!.from, 'utf8')).toContain(text);
    }
    const provenance = resources.find((resource) => resource.to === 'licences/GSAP-provenance.json')!;
    const recorded = JSON.parse(readFileSync(provenance.from, 'utf8'));
    const dependency = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8'));
    expect(recorded.version).toBe(dependency.dependencies.gsap);
    const licence = resources.find((resource) => resource.to === 'licences/GSAP-standard-license.txt')!;
    expect(createHash('sha256').update(readFileSync(licence.from)).digest('hex')).toBe(
      recorded.licenseTextSha256,
    );
  });

  it('keeps release and test builds apart, and can override output and version (update N+1)', () => {
    expect(config.directories?.output).toBe('release');
    expect(builderConfig({}, desktopDir, testBuild).directories?.output).toBe(join('release', 'test'));
    const next = builderConfig(
      { TAALCUT_APP_VERSION: '0.0.1', TAALCUT_PACKAGE_OUTPUT: 'release/update' },
      desktopDir,
      testBuild,
    );
    expect(next.directories?.output).toBe('release/update');
    expect(next.extraMetadata).toEqual({ version: '0.0.1' });
    expect(config.extraMetadata).toBeUndefined();
    expect(() => builderConfig({ TAALCUT_APP_VERSION: 'latest' }, desktopDir, testBuild)).toThrow(/semver/);
  });

  it('publishes to a generic feed only when the build has one (test builds get a placeholder)', () => {
    expect(config.publish).toBeNull();
    expect(builderConfig({}, desktopDir, testBuild).publish).toEqual([
      { provider: 'generic', url: TEST_FEED_PLACEHOLDER },
    ]);
    const feed = 'https://updates.taalcut.dev/dev/';
    expect(builderConfig({}, desktopDir, { ...release, updateFeedUrl: feed }).publish).toEqual([
      { provider: 'generic', url: feed },
    ]);
  });

  it('writes <channel>-mac.yml only when the build has a channel', () => {
    const feed = 'https://updates.taalcut.dev/dev/';
    const alpha = builderConfig({}, desktopDir, { ...release, updateFeedUrl: feed, updateChannel: 'alpha' });
    expect(alpha.publish).toEqual([{ provider: 'generic', url: feed, channel: 'alpha' }]);
    expect(alpha.generateUpdatesFilesForAllChannels).toBeUndefined();
    const plain = builderConfig({}, desktopDir, { ...release, updateFeedUrl: feed });
    expect(plain.publish).toEqual([{ provider: 'generic', url: feed }]);
    expect(builderConfig({}, desktopDir, { ...testBuild, updateChannel: 'alpha' }).publish).toEqual([
      { provider: 'generic', url: TEST_FEED_PLACEHOLDER, channel: 'alpha' },
    ]);
  });

  it('signs ad-hoc with the ad-hoc entitlements unless a Developer ID is given', () => {
    expect(config.mac).toMatchObject({ identity: '-', entitlements: 'packaging/entitlements.adhoc.plist' });
    expect(config.forceCodeSigning).toBe(false);
    const signed = builderConfig({ TAALCUT_MAC_IDENTITY: DEVELOPER_ID }, desktopDir, release);
    // A Developer ID that isn't in the keychain must fail the build, not ship it unsigned.
    expect(signed.forceCodeSigning).toBe(true);
    expect(signed.mac).toMatchObject({
      // electron-builder refuses the "Developer ID Application:" prefix and adds it back itself.
      identity: 'Matterward Labs Private Limited (WW382UC8JD)',
      hardenedRuntime: true,
      entitlements: 'packaging/entitlements.mac.plist',
      entitlementsInherit: 'packaging/entitlements.mac.plist',
    });
  });

  it('leaves the sidecars to afterPack, and the DMG to notarize.ts', () => {
    expect(config.mac?.signIgnore).toEqual(['/Contents/Resources/bin/']);
    expect(config.dmg).toMatchObject({ sign: false, writeUpdateInfo: false });
    expect(config.dmg?.contents).toEqual([
      { x: 180, y: 240, type: 'file' },
      { x: 480, y: 240, type: 'link', path: '/Applications' },
    ]);
    expect(config.afterPack).toBeTypeOf('function');
    expect(config.afterSign).toBeTypeOf('function');
    expect(config.afterAllArtifactBuild).toBeTypeOf('function');
  });
});

describe('entitlements', () => {
  const keys = (file: string) =>
    [...readFileSync(join(desktopDir, file), 'utf8').matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);

  it('Developer ID builds allow JIT, voice consent recording and selected Photos imports', () => {
    expect(keys('packaging/entitlements.mac.plist')).toEqual([
      'com.apple.security.cs.allow-jit',
      'com.apple.security.device.audio-input',
      'com.apple.security.personal-information.photos-library',
    ]);
  });

  it('ad-hoc builds add only disable-library-validation', () => {
    expect(keys('packaging/entitlements.adhoc.plist')).toEqual([
      'com.apple.security.cs.allow-jit',
      'com.apple.security.device.audio-input',
      'com.apple.security.personal-information.photos-library',
      'com.apple.security.cs.disable-library-validation',
    ]);
  });
});

describe('signing identity', () => {
  it('defaults to ad-hoc and trims an explicit identity', () => {
    expect(macIdentity({})).toBe(AD_HOC);
    expect(macIdentity({ TAALCUT_MAC_IDENTITY: '  ' })).toBe(AD_HOC);
    expect(macIdentity({ TAALCUT_MAC_IDENTITY: ' Developer ID Application: X (T) ' })).toBe(
      'Developer ID Application: X (T)',
    );
    expect(entitlementsFile(AD_HOC)).toBe('packaging/entitlements.adhoc.plist');
  });

  it('gives electron-builder the bare name, and finds the team', () => {
    expect(builderIdentity(DEVELOPER_ID)).toBe('Matterward Labs Private Limited (WW382UC8JD)');
    expect(builderIdentity(AD_HOC)).toBe(AD_HOC);
    expect(teamIdOf(DEVELOPER_ID)).toBe('WW382UC8JD');
    expect(teamIdOf(AD_HOC)).toBeUndefined();
  });

  it('signs extra binaries with hardened runtime, timestamped unless ad-hoc', () => {
    expect(codesignArgs(DEVELOPER_ID, '/a/ffmpeg')).toEqual([
      '--force',
      '--sign',
      DEVELOPER_ID,
      '--options',
      'runtime',
      '--timestamp',
      '/a/ffmpeg',
    ]);
    expect(codesignArgs(AD_HOC, '/a/ffmpeg')).toEqual([
      '--force',
      '--sign',
      '-',
      '--options',
      'runtime',
      '/a/ffmpeg',
    ]);
    expect(codesignArgs(AD_HOC, '/a/taalcut-mac-helper', '/e.plist').slice(-3)).toEqual([
      '--entitlements',
      '/e.plist',
      '/a/taalcut-mac-helper',
    ]);
  });

  it('refuses an ad-hoc build that electron-builder could resolve to a keychain identity', () => {
    const list = (name: string) => () =>
      `  1) 9724FB0FADBC1708A85C5FCE8106CCFF85F42F7B "${name}"\n     1 valid identities found\n`;
    expect(() =>
      assertAdHocIsSafe({}, list('Developer ID Application: Jo Bloggs (ABCDE12345)')),
    ).not.toThrow();
    expect(() => assertAdHocIsSafe({}, list('Developer ID Application: Jean-Luc (ABCDE12345)'))).toThrow(
      /"-"/,
    );
    expect(() => assertAdHocIsSafe({ CSC_LINK: '/cert.p12' }, list('x'))).toThrow(/CSC_LINK/);
    expect(() => assertAdHocIsSafe({ CSC_NAME: 'Someone' }, list('x'))).toThrow(/CSC_NAME/);
  });
});
