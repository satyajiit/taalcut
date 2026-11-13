// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The places dataset (LIB1-PLACE): GeoNames' cities (CC-BY 4.0) with its lock and notice, shipped at
 * Contents/Resources/places so the jobs process names places on this Mac (shared/places-paths.ts).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FileSet } from 'electron-builder';
import { PLACES_RESOURCE } from '../src/shared/places-paths';

export function placesResources(projectDir: string): FileSet[] {
  const data = join(projectDir, '..', '..', 'packages', 'library', 'data');
  return existsSync(data) ? [{ from: data, to: PLACES_RESOURCE, filter: ['**/*', '!**/.*'] }] : [];
}
