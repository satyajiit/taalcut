// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Content Credentials (P3-V7, SPEC P3.3): the sidecar client, core's ContentCredentials, manifests, the AI inventory and disclosure reminders. */
export {
  AI_PART_KINDS,
  aiInventory,
  type AiInventory,
  type AiPartKind,
  type MediaPart,
  type ProvenanceKindOf,
} from './ai-inventory';
export { C2PA_UUID, hasC2paManifestBox, topLevelBoxes } from './c2pa-box';
export { inventoryOf, type ProvenanceLookup } from './inventory-of';
export {
  createContentCredentials,
  credentialsSummaryOf,
  signatureState,
  TOLERATED_FAILURES,
  type ContentCredentialsDeps,
  type RenderContentCredentials,
  type SignedExport,
} from './content-credentials';
export { DISCLOSURE_V1, disclosuresFor, type DisclosureData, type DisclosureReminder } from './disclosure.v1';
export {
  ACTIONS_LABEL,
  AI_DIGITAL_SOURCE_TYPES,
  DIGITAL_SOURCE_TYPES,
  exportManifest,
  wholeSourceType,
  type ExportManifest,
  type ExportManifestInput,
} from './manifest';
export {
  C2PA_READ_STATES,
  C2PA_SIDECAR,
  c2paReadSummarySchema,
  createC2paSidecarClient,
  INGREDIENT_RELATIONSHIPS,
  type C2paReadSummary,
  type C2paSidecar,
  type C2paSignRequest,
  type IngredientRelationship,
  type ManifestDefinition,
  type SignIngredientFile,
} from './sidecar';
export {
  C2PA_SIDECAR_ENV,
  c2paSidecarArgs,
  c2paSidecarCandidates,
  resolveC2paSidecar,
  startC2paSidecar,
  type C2paSidecarSources,
} from './sidecar-path';
