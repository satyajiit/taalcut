// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The lan process's environment (security review SB-15). It answers phones on the Wi-Fi, so like the mcp
 * process it inherits nothing it doesn't need from main: no provider keys, proxies, NODE_OPTIONS or DYLD_*
 * a launcher may have set. It keeps the mcp process's few variables (home, temporary folder, PATH, locale)
 * and Taalcut's own TAALCUT_* variables: the development overrides that find FFmpeg and the mac helper in an
 * unpackaged run. A release build refuses to start with any override (switches.ts), so in a shipped app
 * that leaves only the locale hint.
 */
import { mcpProcessEnv } from '../mcp/mcp-env';

const OWN = /^TAALCUT_[A-Z0-9_]+$/;

export function lanProcessEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const kept = mcpProcessEnv(env);
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && OWN.test(name)) kept[name] = value;
  }
  return kept;
}
