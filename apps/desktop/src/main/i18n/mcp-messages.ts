// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The notification main posts when an external agent's call waits for the person (P3-V4): the call is held for
 * 45 seconds, and the person is usually in a terminal. Plain descriptors, as render-messages.ts. `name` is the
 * session's name, which the person chose ("Claude Code on this Mac"): plain text.
 */
import type { MessageDescriptor } from '@lingui/core';

export const MCP_APPROVAL_MESSAGES = {
  title: /*i18n*/ { id: 'notify.mcp.approval.title', message: '{name} is waiting for you' },
  body: /*i18n*/ {
    id: 'notify.mcp.approval.body',
    message: 'It asked to do something that needs your approval. Open Taalcut to approve or decline it.',
  },
} as const satisfies { title: MessageDescriptor; body: MessageDescriptor };
