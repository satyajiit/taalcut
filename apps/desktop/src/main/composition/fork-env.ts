// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The environment each utility process is forked with (security review SB-15). The two that parse untrusted
 * network input, mcp (local HTTP) and lan (phones on the Wi-Fi), get a minimal one built by their feature;
 * the others inherit main's, as Electron does by default.
 */
import { mcpProcessEnv } from '../mcp/mcp-env';
import { lanProcessEnv } from '../transfer/lan-env';

type EnvBuilder = (env: NodeJS.ProcessEnv) => Record<string, string>;

const MINIMAL: ReadonlyMap<string, EnvBuilder> = new Map([
  ['mcp', mcpProcessEnv],
  ['lan', lanProcessEnv],
]);

/** utilityProcess.fork options for `process`: an `env` only when it gets a minimal one. */
export function utilityForkEnv(
  process: string,
  env: NodeJS.ProcessEnv = globalThis.process.env,
): { env?: Record<string, string> } {
  const build = MINIMAL.get(process);
  return build ? { env: build(env) } : {};
}
