// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * @taalcut/tools: tool registry, tool search and the executor. The tool
 * contract itself (defineTool, ToolModule) is in @taalcut/core so domain
 * packages can define tools without depending on this package. See SPEC.md.
 *
 * This file is the package's only public entry point. Other packages import
 * from '@taalcut/tools' and never from a path inside src/.
 */
export { backoffDelay } from './attempts';
export { formatCatalogue, toCallName, type ToolCatalogueEntry, type ToolDescriptor } from './descriptor';
export * from './errors';
export {
  createToolExecutor,
  type ToolCallOptions,
  type ToolExecutor,
  type ToolExecutorOptions,
} from './executor';
export { canonicalJson, contentHash, toolInputHash } from './hash';
export { DEFAULT_INLINE_OUTPUT_LIMIT, defuseTags } from './output';
export type * from './ports';
export {
  createToolRegistry,
  type RegisteredTool,
  type ToolCatalogue,
  type ToolFilter,
  type ToolRegistry,
  type ToolSearchHit,
  type ToolSearchOptions,
} from './registry';
export { DEFAULT_SCHEMA_TARGET, type JsonSchema, type JsonSchemaTarget, type ToolSchema } from './schemas';
export { tokenize } from './search';
export { REDACTED, scrubSecrets } from './scrub';
export { compareSemver, parseSemver, satisfies, type SemVer } from './semver';
export { createMemoryArtifactStore, createMemoryIdempotencyStore, createMemoryToolCache } from './stores';
export * from './sandbox';
export * from './shell';
export * from './mcp-gateway';
export * from './mcp';
export * from './plugins';
export { correctedExample, invalidInputDetail, parseToolInput } from './invalid-input';

export { editorHistoryTools } from './editor-history';

export { editorCatalogueTool } from './editor-catalogue';
export * from './creation';
export { createProductPublisher, type ProductPublisher } from './products/publishing';
export { productPublishingAccounts } from './products/publishing-remote';
export {
  productPublishApprovalHash,
  productPostizPayload,
  validateProductPublishCopy,
  xWeightedLength,
  youtubeTagsLength,
} from './products/publishing-copy';
export type {
  ProductPublishDraft,
  ProductPublisherDeps,
  ProductPublishingAccount,
} from './products/publishing-types';
