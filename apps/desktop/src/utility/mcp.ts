// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The MCP utility process (out/utility/mcp.mjs, P3-V4): started only while External agents is on. */
import { composeMcp } from './roots/mcp-root';
import { exitOnTerminate, runUtility } from './runtime';

exitOnTerminate(runUtility('mcp', (config, main) => composeMcp(config, main), process.parentPort));
