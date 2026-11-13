// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  err,
  newId,
  NotFoundError,
  ok,
  productPublishRecordSchema,
  ValidationError,
  type AsyncResult,
  type ProductPublishId,
  type ProductPublishRecord,
  type TaalcutError,
} from '@taalcut/core';
import {
  productPublishApprovalHash,
  productPostizPayload,
  validateProductPublishCopy,
} from './publishing-copy';
import {
  channelSettingsSchema,
  createdPostsSchema,
  mediaResponseSchema,
  postizRead,
  postizWrite,
  productPublishingAccounts,
} from './publishing-remote';
import { reconcileProductPublication } from './publishing-reconcile';
import type { ProductPublishDraft, ProductPublisherDeps } from './publishing-types';

export function createProductPublisher(deps: ProductPublisherDeps) {
  const now = deps.now ?? Date.now;
  let nextPostAt = 0;
  let queue = Promise.resolve();
  const conflict = (id: string) => err(ConflictError({ entity: 'productPublication', id }));
  async function get(id: ProductPublishId): AsyncResult<ProductPublishRecord> {
    const result = await deps.store.get(id);
    return result.ok && !result.value
      ? err(NotFoundError({ entity: 'productPublication', id }))
      : (result as Awaited<ReturnType<typeof get>>);
  }
  async function save(
    record: ProductPublishRecord,
    patch: Partial<ProductPublishRecord>,
  ): AsyncResult<ProductPublishRecord> {
    const updated = { ...record, ...patch, revision: record.revision + 1, updatedAt: now() };
    const saved = await deps.store.update(updated, record.revision);
    return saved.ok ? ok(updated) : saved;
  }
  async function current(record: ProductPublishRecord): AsyncResult<void> {
    const revision = await deps.campaignRevision(record.campaignId);
    if (!revision.ok) return revision;
    if (revision.value !== record.campaignRevision) return conflict(record.id);
    const media = await deps.verifyRender(record.renderId, record.mediaHash, record);
    return media.ok ? (media.value ? ok(undefined) : conflict(record.id)) : media;
  }
  async function fail(record: ProductPublishRecord, error: TaalcutError): AsyncResult<ProductPublishRecord> {
    const status = error.params?.['status'];
    const rejected =
      (typeof status === 'number' && status >= 400 && status < 500) ||
      [
        'tools.plugin_authentication_failed',
        'tools.plugin_access_denied',
        'tools.plugin_invalid_input',
        'tools.plugin_inactive',
        'tools.plugin_not_found',
        'core.validation',
        'core.not_found',
      ].includes(error.code);
    const retry = error.params?.['retryAfterMs'];
    const throttled = status === 429;
    return save(record, {
      status: throttled ? 'approved' : rejected ? 'failed' : 'unknown',
      errorCode: error.code,
      retryAt: throttled ? now() + (typeof retry === 'number' ? Math.max(retry, 40_000) : 60_000) : null,
    });
  }
  async function dispatch(id: ProductPublishId): AsyncResult<ProductPublishRecord> {
    const loaded = await get(id);
    if (!loaded.ok) return loaded;
    let record = loaded.value;
    if (record.status !== 'approved') return ok(record);
    if (record.retryAt !== null && record.retryAt > now()) return ok(record);
    if (record.approvalHash !== productPublishApprovalHash(record))
      return save(record, { status: 'failed', approvalHash: null, errorCode: 'publish.approval_changed' });
    const fresh = await current(record);
    if (!fresh.ok) return save(record, { status: 'failed', approvalHash: null, errorCode: fresh.error.code });
    const accounts = await productPublishingAccounts(deps.plugins);
    if (!accounts.ok) return accounts;
    if (
      !accounts.value.some(
        (account) => account.id === record.accountId && account.provider === record.provider,
      )
    ) {
      return err(ValidationError({ field: 'accountId' }));
    }
    if (Date.parse(record.scheduledAt) <= now()) {
      return save(record, { status: 'failed', errorCode: 'publish.schedule_elapsed', approvalHash: null });
    }
    const settings = await postizRead(deps.plugins, 'getIntegrationSettings', { id: record.accountId });
    if (!settings.ok) return settings;
    const rules = channelSettingsSchema.safeParse(settings.value);
    if (!rules.success) return err(ValidationError({ field: 'postiz.settings' }));
    const valid = validateProductPublishCopy(record, rules.data.output.maxLength);
    if (!valid.ok) return valid;
    if (nextPostAt > now()) return save(record, { retryAt: nextPostAt });
    if (!record.remoteMedia) {
      const reserved = await save(record, { status: 'uploading', errorCode: null, retryAt: null });
      if (!reserved.ok) return reserved;
      record = reserved.value;
      const uploaded = await postizWrite(
        deps.plugins,
        'uploadFile',
        { renderId: record.renderId, expectedSha256: record.mediaHash, adjust: false },
        `product-upload:${record.id}:${record.revision}`,
      );
      if (!uploaded.ok) return fail(record, uploaded.error);
      const media = mediaResponseSchema.safeParse(uploaded.value);
      if (!media.success) return save(record, { status: 'unknown', errorCode: 'publish.upload_response' });
      const stored = await save(record, { remoteMedia: media.data, status: 'approved' });
      if (!stored.ok) return stored;
      record = stored.value;
    }
    // An edit while uploading must not be sent under the old approval.
    const stillCurrent = await current(record);
    if (!stillCurrent.ok)
      return save(record, { status: 'failed', approvalHash: null, errorCode: stillCurrent.error.code });
    const reserved = await save(record, { status: 'scheduling' });
    if (!reserved.ok) return reserved;
    record = reserved.value;
    nextPostAt = now() + 40_000;
    const sent = await postizWrite(
      deps.plugins,
      'createPost',
      productPostizPayload(record),
      `product-post:${record.id}:${record.revision}`,
    );
    if (!sent.ok) return fail(record, sent.error);
    const posts = createdPostsSchema.safeParse(sent.value);
    const post = posts.success ? posts.data.find((item) => item.integration === record.accountId) : undefined;
    return post
      ? save(record, { status: 'scheduled', remotePostId: post.postId, errorCode: null, retryAt: null })
      : save(record, { status: 'unknown', errorCode: 'publish.post_response' });
  }
  return {
    get,
    accounts: () => productPublishingAccounts(deps.plugins),
    list: deps.store.list.bind(deps.store),
    async prepare(drafts: readonly ProductPublishDraft[]): AsyncResult<readonly ProductPublishRecord[]> {
      if (!drafts.length || drafts.length > 20) return err(ValidationError({ field: 'destinations' }));
      const batchId = newId<'ProductPublishBatch'>();
      const records: ProductPublishRecord[] = [];
      for (const draft of drafts) {
        const first = drafts[0]!;
        if (
          draft.productId !== first.productId ||
          draft.campaignId !== first.campaignId ||
          draft.campaignRevision !== first.campaignRevision
        ) {
          return err(ValidationError({ field: 'campaignId' }));
        }
        const parsed = productPublishRecordSchema.safeParse({
          ...draft,
          id: newId<'ProductPublish'>(),
          batchId,
          revision: 1,
          status: 'draft',
          approvalHash: null,
          remoteMedia: null,
          remotePostId: null,
          publishedUrl: null,
          retryAt: null,
          errorCode: null,
          createdAt: now(),
          updatedAt: now(),
        });
        if (!parsed.success) return err(ValidationError({ field: 'publication' }));
        const valid = validateProductPublishCopy(draft);
        if (!valid.ok) return valid;
        const fresh = await current(parsed.data);
        if (!fresh.ok) return fresh;
        if (records.some((record) => record.accountId === draft.accountId))
          return err(ValidationError({ field: 'accountId' }));
        const providerSettings = { ...parsed.data.providerSettings };
        if (draft.platform === 'youtube') providerSettings['privacyStatus'] ??= 'public';
        if (draft.platform === 'instagram' || draft.platform === 'facebook')
          providerSettings['post_type'] ??= 'post';
        records.push({ ...parsed.data, providerSettings });
      }
      const saved = await deps.store.create(records);
      return saved.ok ? ok(records) : saved;
    },
    /** Expose only through the person-only approval command. */
    async approve(id: ProductPublishId, expectedRevision: number): AsyncResult<ProductPublishRecord> {
      const loaded = await get(id);
      if (!loaded.ok) return loaded;
      const record = loaded.value;
      if (record.revision !== expectedRevision || record.status !== 'draft') return conflict(id);
      const valid = await current(record);
      if (!valid.ok) return valid;
      return save(record, { status: 'approved', approvalHash: productPublishApprovalHash(record) });
    },
    dispatch(id: ProductPublishId): AsyncResult<ProductPublishRecord> {
      const run = queue.then(() => dispatch(id));
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    async reconcile(id: ProductPublishId): AsyncResult<ProductPublishRecord> {
      const record = await get(id);
      return record.ok ? reconcileProductPublication(deps, record.value, save) : record;
    },
    /** Cancels local preparation only. A remote scheduled post requires a separate provider deletion. */
    async cancel(id: ProductPublishId, expectedRevision: number): AsyncResult<ProductPublishRecord> {
      const record = await get(id);
      if (!record.ok) return record;
      if (
        record.value.revision !== expectedRevision ||
        !['draft', 'approved', 'failed'].includes(record.value.status) ||
        record.value.remotePostId
      ) {
        return conflict(id);
      }
      return save(record.value, { status: 'cancelled', approvalHash: null, retryAt: null });
    },
  };
}

export type ProductPublisher = ReturnType<typeof createProductPublisher>;
