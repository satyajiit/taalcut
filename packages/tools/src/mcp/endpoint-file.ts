// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `<userData>/mcp/endpoint.json` (tools SPEC, "The stdio shim"): where the `taalcut mcp` shim finds the server when
 * its configuration names no URL. Only the person's account can read it (0600 in a 0700 folder); it never holds a
 * token. Removed when the server stops, so a stale file means the app died.
 */
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { attemptAsync, type AsyncResult } from '@taalcut/core';

export interface McpEndpoint {
  readonly url: string;
  readonly pid: number;
  readonly startedAt: number;
}

export async function writeEndpointFile(path: string, endpoint: McpEndpoint): AsyncResult<void> {
  const folder = dirname(path);
  return attemptAsync(async () => {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    // Written aside and renamed, so the shim never reads half a file.
    const temporary = join(folder, `.endpoint-${process.pid}.json`);
    await writeFile(temporary, `${JSON.stringify(endpoint)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  });
}

export async function removeEndpointFile(path: string): AsyncResult<void> {
  return attemptAsync(() => rm(path, { force: true }));
}
