// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The mcp process's environment (security review SB-15): it parses untrusted HTTP, so it inherits nothing it
 * doesn't need from main (no provider keys, proxies or NODE_OPTIONS a launcher may have set): only the account's
 * home, its temporary folder, PATH and the locale.
 */
const KEPT = ['HOME', 'TMPDIR', 'PATH', 'LANG', 'LC_ALL'] as const;

export function mcpProcessEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of KEPT) {
    const value = env[name];
    if (value !== undefined) kept[name] = value;
  }
  return kept;
}
