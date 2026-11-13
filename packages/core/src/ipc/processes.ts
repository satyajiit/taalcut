// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The processes of PRD 6.1. Main is the hub: the renderer talks only to main,
 * and main talks to each utility process over its own MessagePort.
 */
/** P3-V4 adds `mcp`: the local MCP server, started only while external agents are on. */
export const PROCESS_NAMES = ['main', 'agent', 'jobs', 'render', 'lan', 'mcp'] as const;
export type ProcessName = (typeof PROCESS_NAMES)[number];

/** The processes main forks with utilityProcess and supervises. */
export const UTILITY_NAMES = ['agent', 'jobs', 'render', 'lan', 'mcp'] as const;
export type UtilityName = (typeof UTILITY_NAMES)[number];
