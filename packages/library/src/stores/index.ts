// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stores core assigns to the library (SPEC.md, Phase 2): templates (P2-T8),
 * timelines and their saved versions (P2-X3), renders (P2-M11), project
 * budgets (P2-X1) and the telemetry outbox (P2-X7). Phase 3: the template
 * library's folders (P3-V14) and Styles (P3-V10).
 */
export { createTemplateStore, type LibraryTemplateStore, type TemplateStoreOptions } from './template-store';
export {
  createTemplateMediaStore,
  keptFileName,
  templateMediaFolder,
  templateMediaPath,
  type LibraryTemplateMediaStore,
} from './template-media-store';
export {
  createTemplateSearch,
  TEMPLATE_SEARCH_V1,
  type TemplateSearchDeps,
  type TemplateSearchFusion,
} from './template-search';
export { MAX_TEMPLATE_ASSET_BYTES, templateAssetPath, UNUSED_TEMPLATE_ASSET_MS } from './template-assets';
export { createTemplateFolderStore, type TemplateFolderStoreOptions } from './template-folder-store';
export { createStyleStore, type LibraryStyleStore, type StyleStoreOptions } from './style-store';
export { styleAssetPath, UNUSED_STYLE_ASSET_MS } from './style-assets';
export {
  asTimeline,
  createTimelineStore,
  type LibraryTimelineStore,
  type TimelineStoreOptions,
} from './timeline-store';
export {
  AUTO_VERSION_INTERVAL_MS,
  AUTO_VERSIONS_KEPT,
  createTimelineVersions,
  type SnapshotInput,
  type TimelineVersionKind,
  type TimelineVersionRecord,
  type TimelineVersions,
} from './timeline-versions';
export { documentHash as timelineDocumentHash } from './timeline-rows';
export { createRenderStore } from './render-store';
export { createShortsRunStore, createShortsCache } from './shorts-store';
export {
  createProjectBudgetStore,
  projectSpend,
  SPEND_CURRENCY,
  type BudgetStoreOptions,
} from './budget-store';
export {
  createTelemetryOutbox,
  TELEMETRY_OUTBOX_CAP,
  type QueuedEnvelope,
  type TelemetryOutbox,
} from './telemetry-outbox';
export { createInstagramSavedStore, type InstagramSavedStoreOptions } from './instagram-saved-store';
// HFW1-WS: a project's HyperFrames workspace (core's WorkspaceStore) and its commands.
export {
  createWorkspaceStore,
  type LibraryWorkspaceStore,
  type WorkspaceExpectation,
  type WorkspaceStoreOptions,
} from './workspace-store';
export {
  createWorkspaceCommands,
  type ReservedChange,
  type WorkspaceCommandDeps,
  type WorkspaceCommands,
} from './workspace-commands';
export { BLOBS_FOLDER, WORKSPACES_FOLDER, workspacesRoot, type WorkspaceBlobs } from './workspace-blobs';
export { isReservedWorkspacePath, RESERVED_WORKSPACE_FOLDER } from './workspace-paths';
export {
  UNNAMED_WORKSPACE_BLOB_MS,
  type WorkspacePruneOptions,
  type WorkspacePruneReport,
} from './workspace-prune';
