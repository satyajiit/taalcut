// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What each MCP permission level lists and lets a session call (tools SPEC, "Sessions and permission levels"):
 *
 *   read    tools that change nothing
 *   edit    read + write + destructive (every destructive call still waits for the in-app card)
 *   export  edit + external + checkpoint tools (render, export), each still waiting for the card
 *
 * Hidden at every level: the experiment sandbox (the built-in agent's scratchpad, not an API) and any tool whose
 * spec says `exposure: { mcp: false }`. Every other registry tool is exposed, so a new tool in a domain package
 * reaches MCP clients with no change here.
 */
import type { McpLevel } from '@taalcut/core';
import type { ToolDescriptor } from '../descriptor';

export const HIDDEN_FAMILIES: ReadonlySet<string> = new Set(['sandbox']);

const RANK: Readonly<Record<McpLevel, number>> = { read: 0, edit: 1, export: 2 };

/** Listed to MCP clients at all (some level). */
export function isExposed(tool: Pick<ToolDescriptor, 'family' | 'exposure'>): boolean {
  return tool.exposure.mcp && !HIDDEN_FAMILIES.has(tool.family);
}

/** The lowest level that lists and runs this tool. */
export function levelNeeded(tool: Pick<ToolDescriptor, 'sideEffect' | 'checkpoint'>): McpLevel {
  if (tool.checkpoint || tool.sideEffect === 'external') return 'export';
  if (tool.sideEffect === 'read') return 'read';
  return 'edit';
}

export function levelAllows(level: McpLevel, needed: McpLevel): boolean {
  return RANK[level] >= RANK[needed];
}

/** For the tool description: whether the person must approve each call in the app. */
export function needsInAppApproval(tool: Pick<ToolDescriptor, 'sideEffect' | 'checkpoint'>): boolean {
  return tool.checkpoint || tool.sideEffect === 'destructive' || tool.sideEffect === 'external';
}
