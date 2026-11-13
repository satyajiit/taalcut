// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The asset profile as views (P2-L1): browse, one asset in full, sources, storage, and the library namespace. */
export { assetDetail, type StoredAssetDetail } from './asset-detail';
export { contactSheetOf } from './asset-contact-sheet';
export { playableOriginal } from './asset-playback';
export { withWaveform, type WaveformReader } from './asset-waveform';
export { browseAssets, type BrowseInput, type BrowsePage, type LibrarySort } from './browse';
export { ASSET_INDEX_STATE_SQL, DEFAULT_AVAILABILITY, filterSql, type FilterSql } from './filters';
export {
  createLibraryService,
  libraryRouter,
  type LibrarySearchPort,
  type LibraryService,
  type LibraryServiceDeps,
} from './library-service';
export { libraryStorage, sourceViews, type StorageOptions } from './sources-view';
export { assetSummaries, indexState, shotSummaries } from './summaries';
export { createProvenanceLookup, provenanceOf } from './provenance';
export { createShotProfileSource, type ShotProfileSourceDeps } from './shot-profiles';
export { shotDescriptions } from './shot-descriptions';
export { clipsAddedSince, type ClipsAdded } from './added-since';
