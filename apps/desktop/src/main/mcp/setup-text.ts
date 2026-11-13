// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The text Settings › External agents copies (tools SPEC, "Connecting Claude Code and Codex"): a `claude mcp add`
 * line or a Codex `config.toml` block, over HTTP or through the `taalcut mcp` shim. Always `127.0.0.1` (never
 * `localhost`, which may resolve to ::1 first), and Claude Code always gets the Authorization header (without it,
 * a 401 would start OAuth). Pure, so every format is unit-tested.
 */
import type { McpSetupFormat } from '@taalcut/core';

export interface SetupTextInput {
  readonly format: McpSetupFormat;
  readonly port: number;
  readonly token: string;
  /** The running app's own shim: <Taalcut.app>/Contents/Resources/bin/taalcut. */
  readonly shimPath: string;
}

/** A double-quoted shell word. */
function shellQuoted(text: string): string {
  return `"${text.replace(/["\\$`]/g, (character) => `\\${character}`)}"`;
}

/** A TOML basic string. */
function tomlQuoted(text: string): string {
  return `"${text.replace(/["\\]/g, (character) => `\\${character}`)}"`;
}

export function setupText({ format, port, token, shimPath }: SetupTextInput): string {
  const url = `http://127.0.0.1:${port}/mcp`;
  switch (format) {
    case 'claude-http':
      return `claude mcp add --transport http taalcut --scope user ${url} --header "Authorization: Bearer ${token}"\n`;
    case 'claude-stdio':
      return `claude mcp add --transport stdio taalcut --scope user --env TAALCUT_MCP_TOKEN=${token} -- ${shellQuoted(shimPath)} mcp\n`;
    case 'codex-http':
      return [
        '[mcp_servers.taalcut]',
        `url = ${tomlQuoted(url)}`,
        `http_headers = { Authorization = ${tomlQuoted(`Bearer ${token}`)} }`,
        'startup_timeout_sec = 20',
        'tool_timeout_sec = 60',
        'default_tools_approval_mode = "writes"',
        '',
      ].join('\n');
    case 'codex-stdio':
      return [
        '[mcp_servers.taalcut]',
        `command = ${tomlQuoted(shimPath)}`,
        'args = ["mcp"]',
        'startup_timeout_sec = 20',
        '',
        '[mcp_servers.taalcut.env]',
        `TAALCUT_MCP_TOKEN = ${tomlQuoted(token)}`,
        '',
      ].join('\n');
    default: {
      const unreachable: never = format;
      return unreachable;
    }
  }
}
