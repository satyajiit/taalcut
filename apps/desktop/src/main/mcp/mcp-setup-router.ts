// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.mcpSetup (owner main, P3-V4): create a session, copy its setup text again, make it a new key. Main
 * mints the bearer, keeps it in the vault, hands the agent only the bearer's hash (session-hashes.ts) and writes the
 * setup text to the clipboard itself, so no procedure ever returns a token and no window ever chooses one.
 */
import {
  err,
  implementContract,
  mcpSetupContract,
  newId,
  ok,
  unwrapRpc,
  type AsyncResult,
  type McpClientKind,
  type McpLevel,
  type McpSessionId,
  type McpSetupFormat,
} from '@taalcut/core';
import type { SecretStore } from '@taalcut/models';
// The bearer helpers alone: the package index would bring the MCP SDK into main's bundle.
import { tokenHash } from '@taalcut/tools/node';
import type { RendererContext } from '../rpc/renderer-connections';
import { copyForAWhile, type Schedule, type SetupClipboard } from './clipboard-copy';
import { McpTokenMissing } from './errors';
import type { McpSessionHashes } from './session-hashes';
import { setupText } from './setup-text';
import { mcpVaultKey, mintMcpToken } from './tokens';

export interface McpSetupDeps {
  readonly vault: SecretStore;
  /** Where the agent gets a new bearer's hash (never the bearer). */
  readonly sessions: McpSessionHashes;
  /** The port the mcp process listens on (MCP_PORT_SETTING). */
  readonly port: () => number;
  readonly shimPath: string;
  /** Cleared two minutes after a copy if it still holds the setup text (clipboard-copy.ts). */
  readonly clipboard: SetupClipboard;
  readonly mint?: () => string;
  /** Tests: when the clipboard is checked for clearing. */
  readonly schedule?: Schedule;
}

export function createMcpSetup(deps: McpSetupDeps) {
  const mint = deps.mint ?? mintMcpToken;
  /** The session exists either way: a failed copy is reported, and "Copy setup" tries again. */
  const copy = (format: McpSetupFormat, token: string): AsyncResult<void> =>
    copyForAWhile(
      deps.clipboard,
      setupText({ format, port: deps.port(), token, shimPath: deps.shimPath }),
      deps.schedule,
    );

  return {
    async createSession(input: {
      name: string;
      client: McpClientKind;
      level: McpLevel;
      copy: McpSetupFormat;
    }): AsyncResult<{ sessionId: McpSessionId; copied: McpSetupFormat }> {
      const sessionId = newId<'McpSession'>();
      const token = mint();
      const stored = await deps.vault.set(mcpVaultKey(sessionId), token);
      if (!stored.ok) return stored;
      const added = await deps.sessions.add({
        sessionId,
        name: input.name,
        client: input.client,
        level: input.level,
        tokenHash: tokenHash(token),
      });
      if (!added.ok) {
        await deps.vault.delete(mcpVaultKey(sessionId));
        return added;
      }
      const copied = await copy(input.copy, token);
      return copied.ok ? ok({ sessionId, copied: input.copy }) : copied;
    },

    async copySetup(input: {
      sessionId: McpSessionId;
      format: McpSetupFormat;
    }): AsyncResult<{ copied: McpSetupFormat }> {
      const token = await deps.vault.get(mcpVaultKey(input.sessionId));
      if (!token.ok) return token;
      if (token.value === undefined) return err(McpTokenMissing({ sessionId: input.sessionId }));
      const copied = await copy(input.format, token.value);
      return copied.ok ? ok({ copied: input.format }) : copied;
    },

    async rotateToken(input: {
      sessionId: McpSessionId;
      copy: McpSetupFormat;
    }): AsyncResult<{ copied: McpSetupFormat }> {
      const key = mcpVaultKey(input.sessionId);
      const before = await deps.vault.get(key);
      if (!before.ok) return before;
      const token = mint();
      const stored = await deps.vault.set(key, token);
      if (!stored.ok) return stored;
      const rotated = await deps.sessions.rotate({
        sessionId: input.sessionId,
        tokenHash: tokenHash(token),
      });
      if (!rotated.ok) {
        await (before.value === undefined ? deps.vault.delete(key) : deps.vault.set(key, before.value));
        return rotated;
      }
      const copied = await copy(input.copy, token);
      return copied.ok ? ok({ copied: input.copy }) : copied;
    },
  };
}

export function mcpSetupRouter(deps: McpSetupDeps) {
  const setup = createMcpSetup(deps);
  const os = implementContract<typeof mcpSetupContract, RendererContext>(mcpSetupContract);
  return os.router({
    createSession: os.createSession.handler(async ({ input }) => unwrapRpc(await setup.createSession(input))),
    copySetup: os.copySetup.handler(async ({ input }) => unwrapRpc(await setup.copySetup(input))),
    rotateToken: os.rotateToken.handler(async ({ input }) => unwrapRpc(await setup.rotateToken(input))),
  });
}
