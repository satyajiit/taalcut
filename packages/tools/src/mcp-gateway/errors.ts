// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The MCP gateway's errors (P3-V4). Their i18n keys are `errors.mcp.<code>` (Settings › External agents); the
 * English texts below are also what a tool result carries, because the external agent's model reads them.
 */
import { defineError, type McpLevel, type TaalcutError } from '@taalcut/core';

/** The session was revoked in Settings: its bearer is refused (401). */
export const McpSessionRevoked = defineError<{ sessionId: string }>('mcp.session_revoked');
/** Unused for 90 days (MCP_SESSION_IDLE_EXPIRY_MS): refused like a revoked one; the row says Expired. */
export const McpSessionExpired = defineError<{ sessionId: string }>('mcp.session_expired');
/** The tool needs a higher level than the session has (a stale tool list). */
export const McpLevelTooLow = defineError<{ level: McpLevel; needed: McpLevel }>('mcp.level_too_low');
/** MCP_MAX_SESSIONS live sessions already. */
export const McpTooManySessions = defineError<{ max: number }>('mcp.too_many_sessions');
/** Held for the person's approval longer than the hold: nothing ran; call again after approving. */
export const McpAwaitingApproval = defineError<{ approvalId: string }>('mcp.awaiting_approval');
/** The person declined the call in Taalcut. */
export const McpDeclined = defineError('mcp.declined');
/** Redoing a destructive change through MCP: it would skip the approval card, so only the person may (in the app). */
export const McpPersonOnly = defineError<{ command: string }>('mcp.person_only');

const SESSION_TEXT = 'This Taalcut connection was revoked.';

/** The English text an external agent's model gets for one of these errors (never `detail`). */
export function mcpErrorText(error: TaalcutError): string | undefined {
  switch (error.code) {
    case McpSessionRevoked.code:
      return SESSION_TEXT;
    case McpSessionExpired.code:
      return 'This Taalcut connection expired after 90 days unused. Make a new one in Settings › External agents.';
    case McpLevelTooLow.code: {
      const needed = error.params?.['needed'];
      return `This connection can't use that tool. It needs the "${String(needed)}" level, which you can give it in Taalcut's Settings › External agents.`;
    }
    case McpAwaitingApproval.code:
      return 'Waiting for approval in Taalcut. Call this tool again with the same arguments after the person approves.';
    case McpDeclined.code:
      return 'Declined in Taalcut.';
    case McpPersonOnly.code:
      return 'That change deletes or replaces something, so only the person can redo it, in Taalcut.';
    default:
      return undefined;
  }
}
