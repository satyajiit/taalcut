// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { POSTIZ_API_URL, POSTIZ_MCP_URL } from './postiz-manifest';

function localHost(host: string): boolean {
  const name = host.toLowerCase();
  if (['localhost', '[::1]'].includes(name)) return true;
  if (name.endsWith('.ts.net') || name.endsWith('.local') || name.endsWith('.localhost')) return true;
  if (/^[a-z][a-z0-9-]*$/.test(name)) return true;
  const numbers = name.split('.').map(Number);
  if (numbers.length !== 4 || numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = numbers;
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b! >= 64 && b! <= 127)
  );
}

function endpoint(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return undefined;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost(url.hostname))) return undefined;
    if (/%2f|%5c|%2e|\\/i.test(url.pathname)) return undefined;
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url;
  } catch {
    return undefined;
  }
}

export const postizConfigSchema = z
  .object({
    'api-url': z.string().default(POSTIZ_API_URL),
    'mcp-url': z.string().default(''),
  })
  .strict()
  .transform((config, ctx): Record<string, string> => {
    const api = endpoint(config['api-url']);
    if (!api || !api.pathname.endsWith('/public/v1')) {
      ctx.addIssue({ code: 'custom', message: 'Use a full Public API base ending in /public/v1.' });
      return z.NEVER;
    }
    const apiUrl = api.href.replace(/\/$/, '');
    const inferred = apiUrl === POSTIZ_API_URL ? POSTIZ_MCP_URL : apiUrl.replace(/\/public\/v1$/, '/mcp');
    const mcp = endpoint(config['mcp-url'] || inferred);
    const official = apiUrl === POSTIZ_API_URL && mcp?.href === POSTIZ_MCP_URL;
    if (!mcp || (!official && mcp.origin !== api.origin)) {
      ctx.addIssue({ code: 'custom', message: 'Self-hosted API and MCP must use the same origin.' });
      return z.NEVER;
    }
    // Never accept the historical /mcp/<api-key> form; a key belongs only in the vault.
    if (!/\/mcp$/.test(mcp.pathname)) {
      ctx.addIssue({ code: 'custom', message: 'Use an MCP endpoint ending in /mcp, without credentials.' });
      return z.NEVER;
    }
    return { 'api-url': apiUrl, 'mcp-url': config['mcp-url'] ? mcp.href.replace(/\/$/, '') : '' };
  });

export function postizMcpUrl(config: Readonly<Record<string, string>>): string {
  return (
    config['mcp-url'] ||
    (config['api-url'] === POSTIZ_API_URL
      ? POSTIZ_MCP_URL
      : config['api-url']!.replace(/\/public\/v1$/, '/mcp'))
  );
}
