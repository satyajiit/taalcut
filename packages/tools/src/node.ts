// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * @taalcut/tools' small Node-only entry: the MCP bearer helpers, for main, which hashes a bearer it minted. The
 * package index would bring the MCP SDK into main's bundle.
 */
export { bearerToken, sameHash, tokenHash } from './mcp/bearer';
