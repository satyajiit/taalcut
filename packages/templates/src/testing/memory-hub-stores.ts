// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * In-memory HubIndexCache and HubSubmissionStore, for tests (the library implements both in the app). Not the
 * template store: lineages stay in `testing/memory-template-store`.
 */
import {
  err,
  NotFoundError,
  ok,
  type HubCachedDocument,
  type HubIndexCache,
  type HubSubmissionId,
  type HubSubmissionStore,
  type HubSubmissionView,
  type SubmissionState,
  type TemplateId,
} from '@taalcut/core';

export function createMemoryHubIndexCache(): HubIndexCache {
  let index: HubCachedDocument | null = null;
  let ratings: HubCachedDocument | null = null;
  return {
    async readIndex() {
      return ok(index);
    },
    async writeIndex(document) {
      index = document;
      return ok(undefined);
    },
    async readRatings() {
      return ok(ratings);
    },
    async writeRatings(document) {
      ratings = document;
      return ok(undefined);
    },
  };
}

export function createMemoryHubSubmissionStore(): HubSubmissionStore {
  const rows = new Map<HubSubmissionId, HubSubmissionView>();
  return {
    async record(submission) {
      rows.set(submission.id, submission);
      return ok(undefined);
    },
    async setState(id, state: SubmissionState, checkedAt) {
      const row = rows.get(id);
      if (!row) return err(NotFoundError({ entity: 'hub submission', id }));
      rows.set(id, { ...row, state, checkedAt });
      return ok(undefined);
    },
    async list(filter) {
      const items = [...rows.values()].filter(
        (row) => filter.templateId === undefined || row.templateId === filter.templateId,
      );
      items.sort((a, b) => b.createdAt - a.createdAt);
      return ok(items);
    },
    async latestFor(templateId: TemplateId) {
      const mine = [...rows.values()].filter((row) => row.templateId === templateId);
      mine.sort((a, b) => b.version - a.version || b.createdAt - a.createdAt);
      const latest = mine[0];
      return ok(latest ? { hubId: latest.hubId, version: latest.version } : null);
    },
  };
}
