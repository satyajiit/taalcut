// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where the experiment sandbox's Seatbelt profiles (offline.sb, fetcher.sb;
 * packages/tools src/sandbox/profiles) are: copied into Contents/Resources
 * by packaging (packaging/sandbox-resources.ts), read from the checkout in
 * development. The jobs process passes this folder to the sandbox as
 * `profilesDir`: a bundled module can't find them next to itself.
 */
import { join } from 'node:path';

/** Inside Contents/Resources. */
export const SANDBOX_PROFILES_RESOURCE = join('sandbox', 'profiles');

export interface SandboxProfilesLocation {
  readonly packaged: boolean;
  /** The app's Resources folder. */
  readonly resourcesPath: string;
  /** apps/desktop in a checkout (a utility process: out/utility/../..). */
  readonly desktopDir: string;
}

export function sandboxProfilesDir(location: SandboxProfilesLocation): string {
  return location.packaged
    ? join(location.resourcesPath, SANDBOX_PROFILES_RESOURCE)
    : join(location.desktopDir, '..', '..', 'packages', 'tools', 'src', 'sandbox', 'profiles');
}
