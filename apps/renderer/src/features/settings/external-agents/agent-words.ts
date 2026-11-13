// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { McpClientKind, McpLevel, McpSessionView, McpSetupFormat } from '@taalcut/core';

/** What each level lets an agent do (P3-V4, D18), as the person reads it. */
export const LEVEL_WORDS: Record<McpLevel, { name: MessageDescriptor; line: MessageDescriptor }> = {
  read: { name: msg`Look only`, line: msg`Sees your clips, templates and projects. Changes nothing.` },
  edit: {
    name: msg`Edit`,
    line: msg`Makes changes you can undo. Asks you before anything that costs money.`,
  },
  export: { name: msg`Edit and export`, line: msg`Also exports videos. Every export still asks you first.` },
};

/** The agent apps Taalcut writes setup for; "Other" gets the generic HTTP text. */
export const CLIENT_WORDS: Record<McpClientKind, MessageDescriptor> = {
  'claude-code': msg`Claude Code`,
  codex: msg`Codex`,
  other: msg`Another agent`,
};

/**
 * The setup text main copies, per client: the first is the default. The stdio setup comes first (security
 * review SB-34): it finds Taalcut through the private endpoint file, while an HTTP client sends its key to
 * whatever answers on the port, which another account on the Mac could hold while Taalcut is closed.
 */
export const CLIENT_FORMATS: Record<McpClientKind, readonly [McpSetupFormat, McpSetupFormat]> = {
  'claude-code': ['claude-stdio', 'claude-http'],
  codex: ['codex-stdio', 'codex-http'],
  other: ['claude-stdio', 'claude-http'],
};

export const FORMAT_WORDS: Record<McpSetupFormat, MessageDescriptor> = {
  'claude-stdio': msg`Copy setup`,
  'claude-http': msg`Copy HTTP setup`,
  'codex-stdio': msg`Copy setup`,
  'codex-http': msg`Copy HTTP setup`,
};

/** Where the person pastes what was copied. */
export const PASTE_WORDS: Record<McpClientKind, MessageDescriptor> = {
  'claude-code': msg`Copied. Paste it into a terminal where you use Claude Code.`,
  codex: msg`Copied. Paste it into Codex’s config file, ~/.codex/config.toml.`,
  other: msg`Copied. Paste it into your agent’s MCP settings.`,
};

export const STATUS_WORDS: Record<McpSessionView['status'], MessageDescriptor> = {
  active: msg`Connected`,
  idle: msg`Not used lately`,
  revoked: msg`Revoked`,
  expired: msg`Expired`,
};
