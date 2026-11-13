// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The pinned shell per platform (LNX1-RND): the builds, which one a host runs, and where each is looked for. */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HEADLESS_SHELL,
  HEADLESS_SHELL_BUILDS,
  headlessShellCandidates,
  headlessShellPlatform,
} from '../../src/engine/headless-shell';

const hyperframesCache = join(homedir(), '.cache', 'hyperframes', 'chrome', 'chrome-headless-shell');

describe('the headless shell table', () => {
  it('pins mac-arm64 and linux64 to Chrome for Testing 157.0.8103.50, with win64 as a typed slot', () => {
    const mac = HEADLESS_SHELL_BUILDS['mac-arm64'];
    expect(mac.zipUrl).toBe(
      'https://storage.googleapis.com/chrome-for-testing-public/157.0.8103.50/mac-arm64/chrome-headless-shell-mac-arm64.zip',
    );
    expect(mac.zipSha256).toBe('082e3fe8fcfac75aec2ef0949d70e8d2254a99ea465450e287e6c06a3f1863ed');
    expect(mac.binary).toBe(join('chrome-headless-shell-mac-arm64', 'chrome-headless-shell'));
    const linux = HEADLESS_SHELL_BUILDS.linux64;
    expect(linux.zipUrl).toBe(
      'https://storage.googleapis.com/chrome-for-testing-public/157.0.8103.50/linux64/chrome-headless-shell-linux64.zip',
    );
    // The linux-x64 component's pin (tools/components/linux/pack-headless-shell.sh).
    expect(linux).toMatchObject({
      zipSha256: '7bf0d41e424efd1d6281c4162993ab9dc5de92fac213c211614905a71c057d0f',
      zipSize: 128_166_087,
      binary: join('chrome-headless-shell-linux64', 'chrome-headless-shell'),
      developmentCache: 'linux-157.0.8103.50',
      sandbox: true,
    });
    expect(HEADLESS_SHELL_BUILDS.win64).toMatchObject({ zipSha256: null, zipSize: null, sandbox: false });
    // macOS keeps HyperFrames' launch as spike 03 measured it.
    expect(mac.sandbox).toBe(false);
  });

  it('picks the build from the platform and architecture, and none for a host without one', () => {
    expect(headlessShellPlatform('darwin', 'arm64')).toBe('mac-arm64');
    expect(headlessShellPlatform('linux', 'x64')).toBe('linux64');
    expect(headlessShellPlatform('win32', 'x64')).toBe('win64');
    expect(headlessShellPlatform('darwin', 'x64')).toBeUndefined();
    expect(headlessShellPlatform('linux', 'arm64')).toBeUndefined();
    expect(HEADLESS_SHELL.platform).toBe(headlessShellPlatform() ?? 'mac-arm64');
    expect(HEADLESS_SHELL.componentId).toBe('hyperframes-headless-shell');
  });

  it("looks in the component, then the checkout's cache, then HyperFrames' cache folder for the platform", () => {
    for (const build of [HEADLESS_SHELL_BUILDS['mac-arm64'], HEADLESS_SHELL_BUILDS.linux64]) {
      const candidates = headlessShellCandidates({
        componentDir: '/data/components/installed/hyperframes-headless-shell/157.0.8103.50-abc',
        development: true,
        packageDir: '/repo/packages/render',
        build,
      });
      expect(candidates).toEqual([
        join('/data/components/installed/hyperframes-headless-shell/157.0.8103.50-abc', build.binary),
        join('/repo/packages/render', '.cache', 'chrome-headless-shell', build.binary),
        join(hyperframesCache, build.developmentCache, build.binary),
      ]);
    }
    expect(
      headlessShellCandidates({ development: false, build: HEADLESS_SHELL_BUILDS.linux64 })[0],
    ).toBeUndefined();
  });

  it('uses only the installed component in a packaged build', () => {
    const candidates = headlessShellCandidates({ componentDir: '/c', development: false });
    expect(candidates).toEqual([join('/c', HEADLESS_SHELL.binary)]);
  });
});
