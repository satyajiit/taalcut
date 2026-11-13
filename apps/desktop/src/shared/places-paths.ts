// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where the places dataset is (LIB1-PLACE): packaging copies packages/library/data (the GeoNames file, its lock and
 * its CC-BY notice) to Contents/Resources/places; a checkout reads it in place.
 */
import { join } from 'node:path';
import { PLACES_DATASET_FILE } from '@taalcut/library';

/** Inside Contents/Resources. */
export const PLACES_RESOURCE = 'places';

export interface PlacesLocation {
  readonly packaged: boolean;
  /** The app's Resources folder. */
  readonly resourcesPath: string;
  /** apps/desktop in a checkout (a utility process: out/utility/../..). */
  readonly desktopDir: string;
}

/** The dataset file: Resources/places/places-v1.bin.gz, or packages/library/data's in a checkout. */
export function placesDatasetPath(location: PlacesLocation): string {
  return location.packaged
    ? join(location.resourcesPath, PLACES_RESOURCE, PLACES_DATASET_FILE)
    : join(location.desktopDir, '..', '..', 'packages', 'library', 'data', PLACES_DATASET_FILE);
}
