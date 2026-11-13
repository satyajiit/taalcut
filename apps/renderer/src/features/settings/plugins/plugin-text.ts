// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { I18n } from '@lingui/core';
import { PLUGIN_MESSAGES } from './plugin-messages';
import { PLUGIN_TOOL_MESSAGES } from './plugin-tool-messages';

const MESSAGES = new Map(
  [...PLUGIN_MESSAGES, ...PLUGIN_TOOL_MESSAGES].map((message) => [message.id, message]),
);

/** Bundled manifests have catalogue entries; a third-party manifest may supply its own display text. */
export function pluginText(i18n: Pick<I18n, '_'>, text: string): string {
  return i18n._(MESSAGES.get(text) ?? { id: text, message: text });
}
