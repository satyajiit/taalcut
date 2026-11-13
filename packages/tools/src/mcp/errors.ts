// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The mcp process's own errors (P3-V4); Settings shows them from the server status. */
import { defineError } from '@taalcut/core';

/** Another app holds the port: Settings offers the next free one (and says the setup text must be copied again). */
export const McpPortInUse = defineError<{ port: number }>('mcp.port_in_use', { retryable: true });
/** The loopback socket couldn't be opened for another reason; `detail` has the system's code. */
export const McpBindFailed = defineError<{ port: number }>('mcp.bind_failed', { retryable: true });
/** More than the session's requests a minute, or calls at once. */
export const McpRateLimited = defineError<{ retryAfterSeconds: number }>('mcp.rate_limited', {
  retryable: true,
});
