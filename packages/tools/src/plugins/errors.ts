// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineError } from '@taalcut/core';

type PluginParams = { pluginId: string };
export const PluginNotFound = defineError<PluginParams>('tools.plugin_not_found');
export const PluginInactive = defineError<PluginParams>('tools.plugin_inactive');
export const PluginAccessDenied = defineError<PluginParams>('tools.plugin_access_denied');
export const PluginInvalidConfig = defineError<PluginParams>('tools.plugin_invalid_config');
export const PluginConnectionFailed = defineError<PluginParams>('tools.plugin_connection_failed', {
  retryable: true,
});
export const PluginAuthenticationFailed = defineError<PluginParams>('tools.plugin_authentication_failed');
export const PluginRemoteFailed = defineError<
  PluginParams & { status?: number; retryAfterMs?: number; outcome?: string }
>('tools.plugin_remote_failed');
export const PluginInvalidTool = defineError<PluginParams>('tools.plugin_invalid_tool');
export const PluginInvalidInput = defineError<PluginParams>('tools.plugin_invalid_input');
export const PluginStorageFailed = defineError<PluginParams>('tools.plugin_storage_failed');
