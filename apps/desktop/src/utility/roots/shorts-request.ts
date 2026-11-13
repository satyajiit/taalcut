// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ok, type AsyncResult, type Container, type ShortsRequest } from '@taalcut/core';
import { createShortsCache } from '@taalcut/library';
import { parseSourceVideoLink } from '@taalcut/templates';
import { z } from 'zod';
import { LibraryDatabaseToken } from '../../shared/tokens';

const metadataSchema = z.object({ sourceUrl: z.string().optional(), url: z.string().optional() });

/** An imported source keeps its canonical backlink even when selected later from the library. */
export async function resolveShortRequest(
  container: Container,
  request: ShortsRequest,
): AsyncResult<ShortsRequest> {
  if (request.sourceUrl) return ok(request);
  const cached = await createShortsCache(container.resolve(LibraryDatabaseToken)).get(
    `shorts.sourceMetadata:${request.assetId}`,
  );
  if (!cached.ok) return cached;
  const metadata = metadataSchema.safeParse(cached.value);
  const raw = metadata.success ? (metadata.data.sourceUrl ?? metadata.data.url) : undefined;
  if (!raw) return ok(request);
  const parsed = parseSourceVideoLink(raw);
  return ok(parsed.ok ? { ...request, sourceUrl: parsed.value.url } : request);
}
