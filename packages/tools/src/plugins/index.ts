// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export { pluginsToolModule } from './agent-tools';
export { createPluginCommands } from './commands';
export * from './provider';
export { postizManifest, postizSkills } from './postiz-manifest';
export * from './errors';
export { createPluginService, type PluginServiceDeps } from './service';
export { createPostizPluginDefinition, postizPluginDefinition, type PostizPluginOptions } from './postiz';
export {
  COMFYUI_DEFAULT_URL,
  comfyuiConfigSchema,
  comfyuiManifest,
  comfyuiSkills,
} from './comfyui-manifest';
export {
  comfyuiPluginDefinition,
  createComfyUiPluginDefinition,
  type ComfyUiPluginOptions,
} from './comfyui';
export {
  INSTAGRAM_EDITS_DEFAULT_URL,
  instagramEditsConfigSchema,
  instagramEditsManifest,
  instagramEditsSkills,
} from './instagram-edits-manifest';
export { INSTAGRAM_EDITS_TOOLS } from './instagram-edits-tools';
export {
  connectInstagramEditsMcp,
  createInstagramEditsSession,
  unwrapEditsMcpValue,
  type ResolvePluginMediaPath,
} from './instagram-edits-session';
export {
  createInstagramEditsPluginDefinition,
  instagramEditsPluginDefinition,
  type InstagramEditsPluginOptions,
} from './instagram-edits';
export type { OpenPluginUpload, UploadInput } from './postiz-http';
export type { PluginMcpConnector, PluginMcpSession, PluginMcpTool } from './mcp-client';
