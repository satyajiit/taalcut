// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import {
  CancelledError,
  err,
  ok,
  ValidationError,
  type Container,
  type ProductKnowledgeInput,
  type ProductSource,
} from '@taalcut/core';
import type { ProductServiceDeps } from '@taalcut/agent';
import { redactText } from '@taalcut/library';
import { createCreationSourceService } from '@taalcut/tools';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { creationSourceHost } from '../creation/sources';
import { fetchCreationResource } from '../creation/network';
import { productDirectoryEvidence } from './directory-evidence';

function documents(source: ProductSource, text: string, locator: string): ProductKnowledgeInput[] {
  const clean = redactText(text).trim();
  if (!clean) return [];
  const result: ProductKnowledgeInput[] = [];
  for (let offset = 0; offset < Math.min(clean.length, 240_000); offset += 23_000) {
    const chunk = clean.slice(offset, offset + 23_000);
    result.push({
      sourceId: source.id,
      locator: `${locator}#part-${result.length + 1}`,
      title: source.label,
      text: chunk,
      digest: createHash('sha256').update(chunk).digest('hex'),
      capturedAt: Date.now(),
    });
  }
  return result;
}

/** Research reads source text; opting into live capture is applied later to the isolated authoring copy. */
export function productSources(container: Container, config: UtilityConfig): ProductServiceDeps['sources'] {
  return {
    async inspect(_product, source, signal) {
      if (signal.aborted) return err(CancelledError());
      if (source.kind === 'directory') return productDirectoryEvidence(config.userData, source, signal);
      if (source.kind === 'url' && source.url) {
        const response = await fetchCreationResource(source.url, { signal, maxBytes: 2 * 1024 * 1024 });
        if (!response.ok) return response;
        if (!/^(?:text\/|application\/(?:json|[a-z.+-]*xml|javascript))/i.test(response.value.contentType))
          return err(
            ValidationError(
              { field: 'source' },
              { detail: 'Attach a readable public page or text document.' },
            ),
          );
        const raw = new TextDecoder().decode(response.value.bytes);
        // Scripts/styles are not product evidence and frequently dwarf the visible page copy.
        const text = /(?:html|xml)/i.test(response.value.contentType)
          ? raw
              .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
              .replace(/<[^>]*>/g, ' ')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/\s+/g, ' ')
          : raw;
        return ok(documents(source, text, response.value.url));
      }
      const inspected = await createCreationSourceService(creationSourceHost(container, config)).inspect(
        {
          ...source,
          status: 'pending',
          evidence: [],
          assetIds: [],
        },
        signal,
      );
      return inspected.ok
        ? ok(documents(source, inspected.value.content ?? '', `asset:${source.assetId}`))
        : inspected;
    },
  };
}
