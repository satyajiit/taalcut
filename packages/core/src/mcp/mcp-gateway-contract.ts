// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The MCP gateway (P3-V4): the agent serves it (UTILITY_CONTRACTS.agent.mcpGateway) and main forwards it to the
 * mcp process's services port (MAIN_SERVICE_CONTRACTS.mcp.gateway). Never in appContract: the mcp process sees
 * bearer hashes and levels, lists tools and runs calls, and nothing else.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { eventIterator, ipc } from '../ipc/contract';
import { MCP_LEVELS, mcpServerStatusSchema, mcpTokenHashSchema } from './mcp-types';

const jsonObject = z.record(z.string(), z.unknown());
export const MCP_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const mcpToolDefSchema = z.object({
  name: z.string().regex(MCP_TOOL_NAME_PATTERN),
  title: z.string().max(200),
  description: z.string().max(4000),
  /** JSON Schema draft 2020-12 of the input. */
  inputSchema: jsonObject,
  outputSchema: jsonObject.optional(),
  annotations: z.object({
    readOnlyHint: z.boolean(),
    destructiveHint: z.boolean(),
    idempotentHint: z.boolean(),
    openWorldHint: z.boolean(),
  }),
});
export type McpToolDef = z.output<typeof mcpToolDefSchema>;

export const mcpCallItemSchema = z.discriminatedUnion('type', [
  /** While a tool runs or an approval is held, at most every 10 s. */
  z.object({
    type: z.literal('progress'),
    fraction: z.number().min(0).max(1).nullable(),
    message: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal('result'),
    isError: z.boolean(),
    structuredContent: jsonObject.optional(),
    /** One text item: JSON, the artifact summary, or the error's English message. */
    text: z.string().max(1_000_000),
  }),
]);
export type McpCallItem = z.output<typeof mcpCallItemSchema>;

const sessionId = idSchema<'McpSession'>();

export const mcpGatewaySessionsSchema = z.object({
  sessions: z
    .array(
      z.object({
        id: sessionId,
        tokenHash: mcpTokenHashSchema,
        level: z.enum(MCP_LEVELS),
        expiresAt: z.int().nonnegative(),
      }),
    )
    .max(64),
});

export const mcpGatewayContract = {
  /** Live sessions' bearer hashes and levels: the whole set first, then after every change. */
  sessions: ipc.output(eventIterator(mcpGatewaySessionsSchema)),
  /** The tools this session's level lists, and the server instructions. */
  listTools: ipc
    .input(z.object({ sessionId }))
    .output(z.object({ tools: z.array(mcpToolDefSchema).max(500), instructions: z.string().max(2000) })),
  /**
   * One tools/call. `callKey` is stable for the same session, tool and arguments for 24 h, so a repeat after an
   * approval resumes the deferred call. Progress items, then exactly one result.
   */
  call: ipc
    .input(
      z.object({
        sessionId,
        callKey: z.string().regex(/^[0-9a-f]{64}$/),
        name: z.string().regex(MCP_TOOL_NAME_PATTERN),
        arguments: jsonObject,
        wantsProgress: z.boolean(),
      }),
    )
    .output(eventIterator(mcpCallItemSchema)),
  /** Last-used bookkeeping, with the client's protocol session id when it has one. */
  touch: ipc
    .input(
      z.object({
        sessionId,
        protocolSession: z
          .string()
          .regex(/^[\x21-\x7e]{1,128}$/)
          .optional(),
      }),
    )
    .output(z.void()),
  /** The mcp process reports listening, port_in_use or bind_failed. */
  reportStatus: ipc.input(mcpServerStatusSchema).output(z.void()),
};
