// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Main's MCP errors (desktop SPEC, "Errors (Phase 3)"). */
import { defineError } from '@taalcut/core';

/**
 * The session's key is gone from the keychain vault (a reset Mac, a restored backup): its setup text can't be
 * copied again. The fix is "Make a new key" (mcpSetup.rotateToken).
 */
export const McpTokenMissing = defineError<{ sessionId: string }>('desktop.mcp_token_missing');
