// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where the signed component manifest is (packages/jobs SPEC, "Signed
 * manifest"): packaging copies tools/components/manifest.signed.json into
 * Contents/Resources; a development run reads it from the checkout.
 */
import { join } from 'node:path';

export const COMPONENT_MANIFEST_FILE = 'manifest.signed.json';

/** From apps/desktop: the signed manifest in the checkout. */
export const COMPONENT_MANIFEST_SOURCE = join('..', '..', 'tools', 'components', COMPONENT_MANIFEST_FILE);

export interface ManifestLocation {
  readonly packaged: boolean;
  /** The app's Resources folder. */
  readonly resourcesPath: string;
  /** apps/desktop/out/utility in a checkout. */
  readonly utilityDir: string;
}

export function componentManifestPath(location: ManifestLocation): string {
  return location.packaged
    ? join(location.resourcesPath, COMPONENT_MANIFEST_FILE)
    : join(location.utilityDir, '..', '..', COMPONENT_MANIFEST_SOURCE);
}
