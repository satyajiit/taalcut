// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Trip and Place filters' choices (LIB1-FIND): place's `library.trips` and `library.places`, asked again when
 * the library changes, since a clip placed or a trip renamed since then changes them. Each is null until the library
 * first answers, so the pills can tell "none yet" from "not asked yet".
 */
import type { PlaceCount, Trip } from '@taalcut/core';
import { useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcQuery } from '../../backend/use-rpc';

export function useLibraryPlaces(): {
  trips: readonly Trip[] | null;
  places: readonly PlaceCount[] | null;
} {
  const backend = useBackend();
  const [round, setRound] = useState(0);
  const trips = useRpcQuery((signal) => backend.library.trips(undefined, { signal }), [backend, round]);
  const places = useRpcQuery((signal) => backend.library.places(undefined, { signal }), [backend, round]);
  useBackendEvents(['library.changed'], () => setRound((n) => n + 1));
  return { trips: trips.data?.trips ?? null, places: places.data?.places ?? null };
}
