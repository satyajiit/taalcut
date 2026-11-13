// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The MCP bearer (P3-V4): minted here in main and nowhere else, kept in the keychain vault so "Copy setup" works
 * later, given to the agent only as its SHA-256 (the gateway stores the hash), and never sent to a window: main
 * writes the setup text to the clipboard itself. A revoked session's vault entry is deleted.
 */
import { randomBytes } from 'node:crypto';
import {
  MCP_COMMANDS,
  MCP_SESSIONS_SETTING,
  type EventBus,
  type McpSessionId,
  type SettingsStore,
} from '@taalcut/core';
import type { SecretStore } from '@taalcut/models';

/** 'tcm_' and 43 base64url characters: 256 random bits (core's MCP_TOKEN_PATTERN). */
export function mintMcpToken(): string {
  return `tcm_${randomBytes(32).toString('base64url')}`;
}

export function mcpVaultKey(sessionId: McpSessionId | string): string {
  return `mcp-token-${sessionId}`;
}

export interface RevokedTokenDeps {
  readonly events: Pick<EventBus, 'on'>;
  readonly settings: Pick<SettingsStore, 'get'>;
  readonly vault: Pick<SecretStore, 'delete'>;
  readonly log?: (message: string) => void;
}

/** After every revoke, the vault forgets the bearers of revoked sessions. */
export function forgetRevokedTokens(deps: RevokedTokenDeps): () => void {
  const log = deps.log ?? ((message: string) => console.warn(message));
  const sweep = async (): Promise<void> => {
    const sessions = await deps.settings.get(MCP_SESSIONS_SETTING);
    if (!sessions.ok) return log(`[mcp] sessions not read: ${sessions.error.code}`);
    for (const session of sessions.value) {
      if (session.revokedAt === null) continue;
      const removed = await deps.vault.delete(mcpVaultKey(session.id));
      if (!removed.ok) log(`[mcp] vault entry not removed: ${removed.error.code}`);
    }
  };
  return deps.events.on('command.changed', (event) => {
    if (event.payload.name === MCP_COMMANDS.revokeSession) void sweep();
  });
}
