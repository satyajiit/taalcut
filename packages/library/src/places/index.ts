// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Places and trips (LIB1-PLACE, SPEC "LIB1-PLACE: places and trips"): the dataset, the geocoder and time-zone
 * hints, the library.place stage and its job, the refresh of every clip's place and trip, and library.renameTrip.
 */
export {
  decodePlaces,
  encodePlaces,
  loadPlaces,
  PLACES_DATASET_FILE,
  PLACES_DATASET_VERSION,
  type PlacesDataset,
} from './dataset';
export { createGeocoder, kmBetween, PLACE_MAX_KM, type Geocoder, type NamedCity } from './geocode';
export { createZoneHints, zoneOffsetMin, type ZoneHints } from './zones';
export {
  settlePlaces,
  NEARBY_OFFSET_MS,
  NEARBY_PLACE_MS,
  type PlaceSubject,
  type SettledPlace,
} from './infer';
export {
  groupTrips,
  matchTrips,
  AWAY_KM,
  MIN_TRIP_CLIPS,
  TRIP_GAP_MS,
  type TripGroup,
  type TripSubject,
} from './trips';
export { assetSearchText, countryWords, placeWords, tripWords } from './search-text';
export { refreshPlaces, type RefreshOptions, type RefreshOutcome } from './refresh';
export {
  createPlaceRefresher,
  lazyPlaces,
  ownPlace,
  placeAsset,
  placeAssetJob,
  placeJobs,
  PlacesUnavailable,
  placeStage,
  PLACE_STAGE_VERSION,
  type PlaceRefresher,
  type PlacesRuntime,
} from './place-stage';
export { createPlaceCommands, renameTrip, type PlaceCommandDeps } from './place-commands';
export { listPlaces, listTrips, placesOf, tripMembers } from '../repositories/places';
