// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ok, err, ValidationError, type AsyncResult, type ProductPublishRecord } from '@taalcut/core';
import { matchingRemotePost, postizRead, postListSchema } from './publishing-remote';
import type { ProductPublisherDeps } from './publishing-types';

type Save = (
  record: ProductPublishRecord,
  patch: Partial<ProductPublishRecord>,
) => AsyncResult<ProductPublishRecord>;

/** A read can confirm a known remote post. Missing evidence never authorizes another external write. */
export async function reconcileProductPublication(
  deps: ProductPublisherDeps,
  record: ProductPublishRecord,
  save: Save,
): AsyncResult<ProductPublishRecord> {
  if (!['unknown', 'uploading', 'scheduling', 'scheduled'].includes(record.status)) return ok(record);
  const instant = Date.parse(record.scheduledAt);
  const listed = await postizRead(deps.plugins, 'listPosts', {
    startDate: new Date(instant - 86_400_000).toISOString(),
    endDate: new Date(instant + 86_400_000).toISOString(),
  });
  if (!listed.ok) return listed;
  const parsed = postListSchema.safeParse(listed.value);
  if (!parsed.success) return err(ValidationError({ field: 'postiz.posts' }));
  const post = matchingRemotePost(record, parsed.data.posts);
  if (!post)
    return record.status === 'scheduled'
      ? ok(record)
      : record.status === 'unknown' && record.errorCode === 'publish.outcome_unknown'
        ? ok(record)
        : save(record, { status: 'unknown', errorCode: 'publish.outcome_unknown' });
  const status = post.state.toUpperCase();
  if (status === 'ERROR' || status === 'FAILED')
    return save(record, { status: 'failed', errorCode: 'publish.remote_failed' });
  if (status === 'PUBLISHED') {
    let publishedUrl: string | null = null;
    try {
      const url = new URL(post.releaseURL ?? '');
      if (['https:', 'http:'].includes(url.protocol)) publishedUrl = url.href;
    } catch {
      /* The provider may not have a release URL yet. */
    }
    return save(record, { status: 'published', publishedUrl, errorCode: null });
  }
  return record.status === 'scheduled' && record.errorCode === null
    ? ok(record)
    : save(record, { status: 'scheduled', errorCode: null });
}
