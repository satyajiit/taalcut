// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * External agents over MCP (P3-V4, D18): sessions, levels, the local server's status and the settings that keep
 * them. Off by default; main starts the mcp process only while MCP_ENABLED_SETTING is on. A session is a bearer
 * token with a level; only its sha256 is stored, and no procedure ever returns a token.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { publicErrorSchema } from '../basics/error-schema';
import { idSchema } from '../basics/ids';
import { defineSetting } from '../ports/preferences';

const count = z.int().nonnegative();
const epochMs = z.int().nonnegative();

export const MCP_LEVELS = ['read', 'edit', 'export'] as const;
export type McpLevel = (typeof MCP_LEVELS)[number];
export const MCP_CLIENT_KINDS = ['claude-code', 'codex', 'other'] as const;
export type McpClientKind = (typeof MCP_CLIENT_KINDS)[number];
/** The setup text main copies to the clipboard. */
export const MCP_SETUP_FORMATS = ['claude-http', 'claude-stdio', 'codex-http', 'codex-stdio'] as const;
export type McpSetupFormat = (typeof MCP_SETUP_FORMATS)[number];
export const MCP_DEFAULT_PORT = 41730;
export const MCP_MAX_SESSIONS = 16;
/** A session unused this long stops working (its row says Expired). */
export const MCP_SESSION_IDLE_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000;
/** sha256 of the bearer, hex. */
export const MCP_TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;
/** The bearer: 'tcm_' and 43 base64url characters; never stored, never sent to a window. */
export const MCP_TOKEN_PATTERN = /^tcm_[A-Za-z0-9_-]{43}$/;

export const mcpPortSchema = z.int().min(1024).max(65535);
export const mcpTokenHashSchema = z.string().regex(MCP_TOKEN_HASH_PATTERN);
export const mcpSessionNameSchema = z.string().trim().min(1).max(60);

/** What is stored (MCP_SESSIONS_SETTING). Never sent to a window: the view drops tokenHash. */
export const mcpSessionRecordSchema = z.object({
  id: idSchema<'McpSession'>(),
  name: mcpSessionNameSchema,
  client: z.enum(MCP_CLIENT_KINDS),
  level: z.enum(MCP_LEVELS),
  tokenHash: mcpTokenHashSchema,
  createdAt: epochMs,
  lastUsedAt: epochMs.nullable(),
  revokedAt: epochMs.nullable(),
  /** Its external agent run and the conversation its approval cards go to. */
  runId: idSchema<'AgentRun'>(),
  conversationId: idSchema<'Conversation'>(),
});
export type McpSessionRecord = z.output<typeof mcpSessionRecordSchema>;

export const MCP_SESSION_STATUSES = ['active', 'idle', 'revoked', 'expired'] as const;
export const mcpSessionViewSchema = mcpSessionRecordSchema.omit({ tokenHash: true }).extend({
  status: z.enum(MCP_SESSION_STATUSES),
  callsToday: count,
  pendingApprovals: count,
});
export type McpSessionView = z.output<typeof mcpSessionViewSchema>;

export const MCP_SERVER_STATES = ['off', 'starting', 'listening', 'error'] as const;
export const mcpServerStatusSchema = z.object({
  state: z.enum(MCP_SERVER_STATES),
  port: mcpPortSchema,
  /** http://127.0.0.1:<port>/mcp while listening. */
  url: z.string().max(64).optional(),
  /** mcp.port_in_use, mcp.bind_failed. */
  error: publicErrorSchema.optional(),
});
export type McpServerStatus = z.output<typeof mcpServerStatusSchema>;

export const mcpStateSchema = z.object({
  enabled: z.boolean(),
  server: mcpServerStatusSchema,
  sessions: z.array(mcpSessionViewSchema).max(64),
});
export type McpState = z.output<typeof mcpStateSchema>;

/** D18: off by default. */
export const MCP_ENABLED_SETTING = defineSetting('mcp.enabled', z.boolean(), false);
export const MCP_PORT_SETTING = defineSetting('mcp.port', mcpPortSchema, MCP_DEFAULT_PORT);
export const MCP_SESSIONS_SETTING = defineSetting(
  'mcp.sessions',
  z.array(mcpSessionRecordSchema).max(64),
  [],
);
