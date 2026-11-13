// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Style profiles (LRN1-STY, SPEC "LRN1-STY: style profiles"): the public face. `profileOf` and its JSON and digest,
 * the plain-words facts, the summary writer, the service, its refresher, the project-style command, and templates
 * stated shot by shot for synthetic sets. The statistics and the per-part builders stay inside.
 */
export { PROFILE_CONFIG } from './profile-config';
export { profileOf, styleProfileDigest, styleProfileJson, type ProfileVectors } from './profile-of';
export { centroid, exemplarCount, medoids, type SlotVectorSet } from './exemplars';
export { profileFacts } from './profile-facts';
export { StyleSummaryEmpty } from './profile-errors';
export {
  STYLE_SUMMARY_PROMPT,
  SUMMARY_MAX_CHARS,
  writeStyleSummary,
  type StyleSummaryDeps,
  type SummaryImage,
} from './summary';
export {
  buildProfile,
  plannedDigest,
  type BuildDeps,
  type BuiltProfile,
  type OpenTemplateIndex,
} from './build-profile';
export {
  createStyleProfiles,
  type RefreshOutcome,
  type StyleProfiles,
  type StyleProfilesDeps,
} from './style-profiles';
export {
  createStyleProfileRefresher,
  PROFILE_REFRESH_QUIET_MS,
  type StyleProfileRefresher,
  type StyleProfileRefresherDeps,
} from './refresher';
export { createStyleProfileCommands } from './style-commands';
export { withStyleProfileReads } from './style-profile-reads';
export {
  syntheticId,
  syntheticTemplate,
  type SyntheticTemplateSpec,
  type SyntheticText,
} from './synthetic-set';
