// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The experiment sandbox's and the workspace shell's Seatbelt profiles
 * (packages/tools src/sandbox/profiles/*.sb), shipped at
 * Contents/Resources/sandbox/profiles so the packaged jobs process can pass
 * them to sandbox-exec (shared/sandbox-profiles.ts), with the licence of the
 * Codex policy workspace.sb opens with (LICENSES/). Text files, sealed by the
 * app's signature like every other resource.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FileSet } from 'electron-builder';
import { SANDBOX_PROFILES_RESOURCE } from '../src/shared/sandbox-profiles';

export function sandboxResources(projectDir: string): FileSet[] {
  const profiles = join(projectDir, '..', '..', 'packages', 'tools', 'src', 'sandbox', 'profiles');
  return existsSync(profiles)
    ? [{ from: profiles, to: SANDBOX_PROFILES_RESOURCE, filter: ['*.sb', 'LICENSES/*.txt'] }]
    : [];
}
