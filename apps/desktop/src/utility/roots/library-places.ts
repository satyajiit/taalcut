// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Places in the jobs process (LIB1-PLACE): the library.placeAsset job over the bundled GeoNames dataset (read on
 * the first job), and the refresh of every clip's place and trip it asks for. One refresh also runs a while after
 * launch, so trips follow what changed while the app was closed (clips in the bin, this Mac's time zone).
 */
import { join } from 'node:path';
import { createToken, EventBusToken, type Container, type JobRegistration } from '@taalcut/core';
import {
  createPlaceRefresher,
  lazyPlaces,
  placeJobs,
  type PlaceRefresher,
  type PlacesRuntime,
} from '@taalcut/library';
import { placesDatasetPath } from '../../shared/places-paths';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { LibraryDatabaseToken } from '../../shared/tokens';

interface PlacesWiring {
  readonly path: string;
  readonly places: () => PlacesRuntime | null;
  readonly refresher: PlaceRefresher;
  readonly first: ReturnType<typeof setTimeout>;
}

const PlacesToken = createToken<PlacesWiring>('desktop.places');

/** The refresh after launch waits for the start to settle; it is never urgent. */
const FIRST_REFRESH_MS = 30_000;

export function registerPlaces(
  container: Container,
  config: Pick<UtilityConfig, 'packaged' | 'resourcesPath'>,
): void {
  container.factory(
    PlacesToken,
    ({ db, events }) => {
      const path = placesDatasetPath({
        packaged: config.packaged,
        resourcesPath: config.resourcesPath,
        desktopDir: join(import.meta.dirname, '..', '..'),
      });
      const places = lazyPlaces(path);
      const refresher = createPlaceRefresher({
        db,
        places,
        events,
        log: (message) => console.warn(`[places] ${message}`),
      });
      const first = setTimeout(() => refresher.request(), FIRST_REFRESH_MS);
      first.unref();
      return { path, places, refresher, first };
    },
    {
      deps: { db: LibraryDatabaseToken, events: EventBusToken },
      dispose: (wiring) => {
        clearTimeout(wiring.first);
        wiring.refresher.stop();
      },
    },
  );
}

/** library.placeAsset, for the engine beside the library's other kinds. */
export function placeJobRegistrations(container: Container): JobRegistration[] {
  const { path, places, refresher } = container.resolve(PlacesToken);
  return placeJobs({ db: container.resolve(LibraryDatabaseToken), places, path, refresher });
}
