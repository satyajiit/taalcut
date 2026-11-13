// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { phase1Core } from './0001-phase1-core';
import { libraryStubs } from './0002-library-stubs';
import { vectorRegistry } from './0003-vector-registry';
import { libraryAdr0001 } from './0004-library-adr-0001';
import { corePorts } from './0005-core-ports';
import { chatStore } from './0006-chat-store';
import { traces } from './0007-traces';
import { rationalRates } from './0008-rational-rates';
import { artifacts } from './0009-artifacts';
import { jobInterruptions } from './0010-job-interruptions';
import { jobResourceClasses } from './0011-job-resource-classes';
import { mediaLibraryV2 } from './0012-media-library-v2';
import { librarySearch } from './0013-library-search';
import { templateStore } from './0014-template-store';
import { projectsVersions } from './0015-projects-versions';
import { renders } from './0016-renders';
import { telemetryOutbox } from './0017-telemetry-outbox';
import { assetBeatMaps } from './0018-asset-beat-maps';
import { stockAndProvenance } from './0019-stock-and-provenance';
import { templateLibraryStyles } from './0020-template-library-styles';
import { hubClient } from './0021-hub-client';
import { voiceAndGenerated } from './0022-voice-and-generated';
import { usageAndImports } from './0023-usage-and-imports';
import { templateNameKeys } from './0024-template-name-keys';
import { jobOrderKey } from './0025-job-order-key';
import { indexMilestones } from './0026-index-milestones';
import { stageOutputDigests } from './0027-stage-output-digests';
import { reducedUaSourceNames } from './0028-reduced-ua-source-names';
import { instagramSaved } from './0029-instagram-saved';
import { memory } from './0030-memory';
import { styleProfiles } from './0031-style-profiles';
import { retryModelAndFilmstripFailures } from './0032-retry-model-and-filmstrip-failures';
import { captureOffsets } from './0033-capture-offsets';
import { placesAndTrips } from './0034-places-and-trips';
import { assetSpokenLanguage } from './0035-asset-spoken-language';
import { shotActions } from './0036-shot-actions';
import { templateMedia } from './0037-template-media';
import { templateReferenceLinks } from './0038-template-reference-links';
import { commandGroups } from './0039-command-groups';
import { timelineComments } from './0040-timeline-comments';
import { workspaces } from './0041-workspaces';
import { wipeProjectsAndTemplates } from './0042-wipe-projects-and-templates';
import { importSessions } from './0043-import-sessions';
import { captureArchives } from './0044-capture-archives';
import { shorts } from './0046-shorts';
import { creationProjects } from './0045-creation-projects';
import { products } from './0047-products';
import { productKnowledgeSearch } from './0048-product-knowledge-search';
import { cloudCallBilling } from './0049-cloud-call-billing';
import type { Migration } from './types';

/** Every migration, in order. Append only. */
export const LIBRARY_MIGRATIONS: readonly Migration[] = [
  phase1Core,
  libraryStubs,
  vectorRegistry,
  libraryAdr0001,
  corePorts,
  chatStore,
  traces,
  rationalRates,
  artifacts,
  jobInterruptions,
  jobResourceClasses,
  mediaLibraryV2,
  librarySearch,
  templateStore,
  projectsVersions,
  renders,
  telemetryOutbox,
  assetBeatMaps,
  stockAndProvenance,
  templateLibraryStyles,
  hubClient,
  voiceAndGenerated,
  usageAndImports,
  templateNameKeys,
  jobOrderKey,
  indexMilestones,
  stageOutputDigests,
  reducedUaSourceNames,
  instagramSaved,
  memory,
  styleProfiles,
  retryModelAndFilmstripFailures,
  captureOffsets,
  placesAndTrips,
  assetSpokenLanguage,
  shotActions,
  templateMedia,
  templateReferenceLinks,
  commandGroups,
  timelineComments,
  workspaces,
  wipeProjectsAndTemplates,
  importSessions,
  captureArchives,
  creationProjects,
  shorts,
  products,
  productKnowledgeSearch,
  cloudCallBilling,
];
