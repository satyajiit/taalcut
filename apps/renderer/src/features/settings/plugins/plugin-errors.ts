// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';

export const PLUGIN_ERROR_MESSAGES = [
  msg({
    id: 'errors.tools.plugin_not_found',
    message: 'This plugin is unavailable. Open Plugins to choose an available service.',
  }),
  msg({
    id: 'errors.tools.plugin_inactive',
    message: 'This plugin is inactive. Connect it and turn on access for the AI.',
  }),
  msg({
    id: 'errors.tools.plugin_access_denied',
    message: 'This plugin does not have the required access. Review its permissions.',
  }),
  msg({
    id: 'errors.tools.plugin_invalid_config',
    message: 'The connection address is invalid. Check the API and MCP addresses for your instance.',
  }),
  msg({
    id: 'errors.tools.plugin_connection_failed',
    message: 'Taalcut could not reach this plugin. Check the address and your network, then test again.',
  }),
  msg({
    id: 'errors.tools.plugin_authentication_failed',
    message: 'The plugin refused this credential. Copy a valid key from its settings and import it again.',
  }),
  msg({
    id: 'errors.tools.plugin_remote_failed',
    message: 'The service could not complete this request. Check its status and try again.',
  }),
  msg({
    id: 'errors.tools.plugin_invalid_tool',
    message: 'This tool is no longer available. Refresh the plugin’s tools and try again.',
  }),
  msg({
    id: 'errors.tools.plugin_invalid_input',
    message: 'The plugin could not use these details. Check them and try again.',
  }),
  msg({
    id: 'errors.tools.plugin_storage_failed',
    message: 'Taalcut could not save this plugin’s settings. Try again.',
  }),
];
