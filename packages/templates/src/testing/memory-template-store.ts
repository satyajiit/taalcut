// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * In-memory TemplateStore. Snapshot it to reopen this port; library SQLite is a different store. The records,
 * summary and list row are memory-template-record.ts, the filters and sorts library/memory-template-query.ts,
 * the assets memory-assets.ts.
 */
import {
  ConflictError,
  err,
  NotFoundError,
  ok,
  ValidationError,
  type AsyncResult,
  type Clock,
  type StoredTemplateVersion,
  type TemplateId,
  type TemplateListQuery,
  type TemplateStore,
  type TemplateVersionSummary,
} from '@taalcut/core';
import { selectTemplates } from '../library/memory-template-query';
import { createMemoryAssets } from './memory-assets';
import {
  contactSheetsOf,
  jsonClone,
  newLineage,
  queryRowOf,
  restoreLineage,
  snapshotLineage,
  summaryOf,
  versionOf,
  type Lineage,
  type MemoryTemplateSnapshot,
} from './memory-template-record';

export type { MemoryTemplateSnapshot } from './memory-template-record';

/** Abandoned breakdowns' sheets go after this long with no version pointing at them (SPEC P2-T8). */
export const ORPHAN_ASSET_MS = 7 * 24 * 3_600_000;

export interface MemoryTemplateStore extends TemplateStore {
  /** Test hook: how many timelines use the template (library joins timelines for this). */
  setUsage(templateId: TemplateId, timelines: number): void;
  /** The store's asset sweep: assets no version refers to, older than ORPHAN_ASSET_MS, are removed. */
  pruneAssets(): string[];
  assetBytes(sha256: string): Uint8Array | undefined;
  /** Days after which a trend date is stale. Default 90 (`templates.staleAfterDays`). */
  setStaleAfterDays(days: number): void;
  /** JSON-safe copy. Construct another store from it to reopen this port (not library SQL). */
  snapshot(): MemoryTemplateSnapshot;
}

export function createMemoryTemplateStore(
  clock: Clock,
  snapshot?: MemoryTemplateSnapshot,
): MemoryTemplateStore {
  const lineages = new Map<TemplateId, Lineage>(
    (snapshot?.lineages ?? []).map((row) => [row.id, restoreLineage(row)]),
  );
  const usage = new Map<TemplateId, number>(
    (snapshot?.usage ?? []).map((row) => [row.templateId, row.timelines]),
  );
  const assets = createMemoryAssets<{ readonly at: number }>(
    'templates',
    (snapshot?.assets ?? []).map((asset) => [
      asset.sha256,
      { bytes: Uint8Array.from(asset.bytes), at: asset.at },
    ]),
  );
  let staleAfterDays = snapshot?.staleAfterDays ?? 90;

  const lineageOf = (templateId: TemplateId) => {
    const lineage = lineages.get(templateId);
    return lineage ? ok(lineage) : err(NotFoundError({ entity: 'template', id: templateId }));
  };
  const referenced = () => new Set([...lineages.values()].flatMap(contactSheetsOf));
  const touched = (lineage: Lineage) => {
    lineage.updatedAt = clock.now();
    return ok(summaryOf(lineage));
  };

  return {
    async create(template, meta) {
      if (lineages.has(template.id)) return err(ConflictError({ entity: 'template', id: template.id }));
      if (template.version !== 1 || template.parentVersion !== null)
        return err(ValidationError({ field: 'version' }, { detail: 'A new template starts at version 1' }));
      const now = clock.now();
      const lineage = newLineage(template, meta, now);
      lineage.versions.set(
        1,
        versionOf(template, { createdAt: now, command: null, source: null, changeKey: null }),
      );
      lineages.set(template.id, lineage);
      return ok(summaryOf(lineage));
    },

    async addVersion(template, change) {
      const found = lineageOf(template.id);
      if (!found.ok) return found;
      const lineage = found.value;
      if (lineage.versions.has(template.version))
        return err(ConflictError({ entity: 'template version', id: `${template.id}@${template.version}` }));
      if (template.parentVersion === null || !lineage.versions.has(template.parentVersion))
        return err(ValidationError({ field: 'parentVersion' }, { detail: 'The parent version must exist' }));
      lineage.versions.set(template.version, versionOf(template, { createdAt: clock.now(), ...change }));
      lineage.head = template.version;
      return touched(lineage);
    },

    async setHead({ templateId, version, expectedHead }) {
      const found = lineageOf(templateId);
      if (!found.ok) return found;
      const lineage = found.value;
      if (lineage.head !== expectedHead)
        return err(
          ConflictError({ entity: 'template', id: templateId }, { detail: `head is ${lineage.head}` }),
        );
      if (!lineage.versions.has(version))
        return err(NotFoundError({ entity: 'template version', id: `${templateId}@${version}` }));
      lineage.head = version;
      return touched(lineage);
    },

    async setMeta(templateId, patch) {
      const found = lineageOf(templateId);
      if (!found.ok) return found;
      const lineage = found.value;
      if (patch.name !== undefined) lineage.name = patch.name;
      if (patch.listed !== undefined) lineage.listed = patch.listed;
      if (patch.archived !== undefined) lineage.archived = patch.archived;
      if (patch.tags !== undefined) lineage.tags = [...patch.tags];
      if (patch.folderId !== undefined) lineage.folderId = patch.folderId;
      if (patch.favourite !== undefined) lineage.favourite = patch.favourite;
      if (patch.trendFreshness !== undefined) lineage.trendFreshness = patch.trendFreshness;
      if (patch.provenance !== undefined) lineage.provenance = patch.provenance;
      return touched(lineage);
    },

    async remove(templateId) {
      const found = lineageOf(templateId);
      if (!found.ok) return found;
      lineages.delete(templateId);
      const stillUsed = referenced();
      for (const asset of contactSheetsOf(found.value)) if (!stillUsed.has(asset)) assets.remove(asset);
      return ok(undefined);
    },

    async get(templateId, version) {
      const found = lineageOf(templateId);
      if (!found.ok) return found;
      const lineage = found.value;
      const stored = lineage.versions.get(version ?? lineage.head);
      if (!stored) return err(NotFoundError({ entity: 'template version', id: `${templateId}@${version}` }));
      const result: StoredTemplateVersion = {
        summary: summaryOf(lineage),
        version: stored.version,
        schemaVersion: stored.schemaVersion,
        json: jsonClone(stored.json),
      };
      return ok(result);
    },

    async findChild(templateId, parentVersion, changeKey) {
      const found = lineageOf(templateId);
      if (!found.ok) return found;
      const child = [...found.value.versions.values()].find(
        (version) => version.parentVersion === parentVersion && version.changeKey === changeKey,
      );
      return ok(child?.version ?? null);
    },

    async latestVersion(templateId) {
      const found = lineageOf(templateId);
      return found.ok ? ok(Math.max(...found.value.versions.keys())) : found;
    },

    async versions(templateId): AsyncResult<TemplateVersionSummary[]> {
      const found = lineageOf(templateId);
      if (!found.ok) return found;
      const lineage = found.value;
      return ok(
        [...lineage.versions.values()]
          .sort((a, b) => a.version - b.version)
          .map((version) => ({
            version: version.version,
            parentVersion: version.parentVersion,
            createdAt: version.createdAt,
            command: version.command,
            source: version.source,
            isHead: version.version === lineage.head,
          })),
      );
    },

    async list(query: TemplateListQuery) {
      const rows = [...lineages.values()].map((lineage) => queryRowOf(lineage, usage.get(lineage.id) ?? 0));
      const matches = selectTemplates(rows, query, clock.now(), staleAfterDays);
      const start = query.cursor ? Number(query.cursor) : 0;
      const page = matches.slice(start, start + query.limit).map((row) => summaryOf(row.lineage));
      const next = start + query.limit < matches.length ? String(start + query.limit) : null;
      return ok({ items: page, nextCursor: next });
    },

    async usedBy(templateId) {
      return ok(usage.get(templateId) ?? 0);
    },

    putAsset: (bytes) => assets.put(bytes, { at: clock.now() }),
    assetPath: (sha256) => assets.path(sha256),

    setUsage(templateId, timelines) {
      usage.set(templateId, timelines);
    },

    pruneAssets() {
      const used = referenced();
      const removed = assets
        .entries()
        .filter(([sha256, asset]) => !used.has(sha256) && clock.now() - asset.at >= ORPHAN_ASSET_MS)
        .map(([sha256]) => sha256);
      for (const sha256 of removed) assets.remove(sha256);
      return removed;
    },

    assetBytes: (sha256) => assets.bytes(sha256),

    setStaleAfterDays(days) {
      staleAfterDays = days;
    },

    snapshot() {
      return {
        staleAfterDays,
        lineages: [...lineages.values()].map(snapshotLineage),
        usage: [...usage.entries()].map(([templateId, timelines]) => ({ templateId, timelines })),
        assets: assets
          .entries()
          .map(([sha256, asset]) => ({ sha256, bytes: [...asset.bytes], at: asset.at })),
      };
    },
  };
}
