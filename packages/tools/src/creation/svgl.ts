// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineError, err, ok, type AsyncResult } from '@taalcut/core';
import type { CreationSourceHost } from './ports';

export const CreationLogoFailed = defineError('tools.creation_logo_failed', { retryable: true });
export interface CreationBrandLogo {
  readonly name: string;
  readonly sourceUrl: string;
  readonly svg: string;
}

/** Reject active SVG instead of trying to repair markup before putting it in an executable composition. */
export function safeCreationSvg(svg: string): boolean {
  return (
    svg.length <= 512_000 &&
    /<svg[\s>]/i.test(svg) &&
    !/<(?:script|foreignObject|iframe|object|embed|image|use)\b/i.test(svg) &&
    !/\bon[a-z]+\s*=|(?:href|src)\s*=|url\s*\(|<!ENTITY|<!DOCTYPE|<\?xml-stylesheet/i.test(svg)
  );
}

export function createCreationLogoService(host: Pick<CreationSourceHost, 'request'>) {
  return {
    async find(name: string, signal: AbortSignal): AsyncResult<readonly CreationBrandLogo[]> {
      const query = name.trim().slice(0, 100);
      if (!query) return ok([]);
      const listed = await host.request(`https://api.svgl.app?search=${encodeURIComponent(query)}`, {
        kind: 'json',
        signal,
        maxBytes: 256_000,
      });
      if (!listed.ok) return listed;
      let rows: unknown;
      try {
        rows = JSON.parse(listed.value.body);
      } catch {
        return err(CreationLogoFailed());
      }
      if (!Array.isArray(rows)) return err(CreationLogoFailed());
      const logos: CreationBrandLogo[] = [];
      for (const row of rows.slice(0, 3)) {
        if (!row || typeof row !== 'object' || typeof row.title !== 'string') continue;
        const route = typeof row.route === 'string' ? row.route : row.route?.light;
        if (typeof route !== 'string') continue;
        let url: URL;
        try {
          url = new URL(route, 'https://svgl.app');
        } catch {
          continue;
        }
        if (url.protocol !== 'https:' || !['svgl.app', 'www.svgl.app'].includes(url.hostname)) continue;
        const fetched = await host.request(url.href, { kind: 'svg', signal, maxBytes: 512_000 });
        if (!fetched.ok || !safeCreationSvg(fetched.value.body)) continue;
        logos.push({ name: row.title, sourceUrl: url.href, svg: fetched.value.body });
      }
      return ok(logos);
    },
  };
}
