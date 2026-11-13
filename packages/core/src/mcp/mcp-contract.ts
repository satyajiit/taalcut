// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The windows' MCP namespaces (P3-V4): `mcp` (owner agent) reads the state for Settings › External agents;
 * `mcpSetup` (owner main) mints and keeps the bearer in the keychain vault, hands the agent its hash
 * (mcpSessionsContract) and writes the setup text to the clipboard itself, so no procedure ever returns a token
 * and no window chooses a hash. Other changes are MCP_COMMANDS (person-only).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { eventIterator, ipc } from '../ipc/contract';
import {
  MCP_CLIENT_KINDS,
  MCP_LEVELS,
  MCP_SETUP_FORMATS,
  mcpSessionNameSchema,
  mcpStateSchema,
} from './mcp-types';

export const mcpContract = {
  state: ipc.output(mcpStateSchema),
  /** The current state first, then every change (last-used times at most once a minute). */
  changed: ipc.output(eventIterator(mcpStateSchema)),
};

const sessionId = idSchema<'McpSession'>();
const copied = z.object({ copied: z.enum(MCP_SETUP_FORMATS) });

export const mcpSetupContract = {
  createSession: ipc
    .input(
      z.object({
        name: mcpSessionNameSchema,
        client: z.enum(MCP_CLIENT_KINDS),
        level: z.enum(MCP_LEVELS),
        copy: z.enum(MCP_SETUP_FORMATS),
      }),
    )
    .output(copied.extend({ sessionId })),
  /** core.not_found for a revoked or unknown session. */
  copySetup: ipc.input(z.object({ sessionId, format: z.enum(MCP_SETUP_FORMATS) })).output(copied),
  /** A new bearer; the old one stops working. */
  rotateToken: ipc.input(z.object({ sessionId, copy: z.enum(MCP_SETUP_FORMATS) })).output(copied),
};
