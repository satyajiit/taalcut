// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The sandbox's Seatbelt profiles ship in Contents/Resources/sandbox/profiles
 * and the jobs process finds them there when packaged, in the checkout
 * otherwise.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { builderConfig } from '../packaging/builder-config';
import { sandboxResources } from '../packaging/sandbox-resources';
import { SANDBOX_PROFILES_RESOURCE, sandboxProfilesDir } from '../src/shared/sandbox-profiles';

const desktopDir = join(import.meta.dirname, '..');

describe('sandbox profiles', () => {
  it('are found in Resources when packaged and in packages/tools in a checkout', () => {
    expect(sandboxProfilesDir({ packaged: true, resourcesPath: '/R', desktopDir })).toBe(
      join('/R', 'sandbox', 'profiles'),
    );
    const checkout = sandboxProfilesDir({ packaged: false, resourcesPath: '/R', desktopDir });
    expect(existsSync(join(checkout, 'offline.sb'))).toBe(true);
    expect(existsSync(join(checkout, 'fetcher.sb'))).toBe(true);
    expect(existsSync(join(checkout, 'workspace.sb'))).toBe(true);
    expect(existsSync(join(checkout, 'LICENSES', 'Codex-Apache-2.0.txt'))).toBe(true);
  });

  it('are copied into the bundle', () => {
    const [set] = sandboxResources(desktopDir);
    expect(set).toEqual({
      from: sandboxProfilesDir({ packaged: false, resourcesPath: '', desktopDir }),
      to: SANDBOX_PROFILES_RESOURCE,
      filter: ['*.sb', 'LICENSES/*.txt'],
    });
    const config = builderConfig({}, desktopDir, {
      flavour: 'release',
      updateFeedUrl: undefined,
      updateChannel: undefined,
      crashDsn: undefined,
      telemetryUrl: undefined,
    });
    expect(config.mac?.extraResources).toContainEqual(set);
  });
});
