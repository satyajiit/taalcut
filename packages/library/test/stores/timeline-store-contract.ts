// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TimelineStore's port semantics (core, timeline/timeline-store.ts), as a
 * suite any implementation must pass: revisions, a conflict on a stale
 * revision, summaries from the document, removal.
 */
import {
  TIMELINE_SCHEMA_VERSION,
  unwrap,
  type AssetId,
  type ProjectId,
  type TimelineStore,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { edited, timeline } from './documents';

export interface TimelineStoreFixture {
  readonly store: TimelineStore;
  readonly projectId: ProjectId;
  readonly assets: readonly [AssetId, AssetId];
}

export function timelineStoreContract(name: string, make: () => TimelineStoreFixture): void {
  describe(`${name} honours the TimelineStore port`, () => {
    it('creates a timeline and summarises its document', async () => {
      const { store, projectId, assets } = make();
      const doc = timeline(projectId, assets);
      const summary = unwrap(await store.create(doc));
      expect(summary).toMatchObject({
        id: doc.id,
        projectId,
        name: 'Goa, variant 1',
        revision: 1,
        clipCount: 2,
      });
      expect(summary.duration).toEqual({ value: 150, rate: { num: 30, den: 1 } });
      expect(summary.template).toEqual(doc.template);
      const stored = unwrap(await store.get(doc.id));
      expect([stored.schemaVersion, stored.json]).toEqual([
        TIMELINE_SCHEMA_VERSION,
        JSON.parse(JSON.stringify(doc)),
      ]);
      const twice = await store.create(doc);
      expect(!twice.ok && twice.error.code).toBe('core.conflict');
    });

    it('puts a new revision only over the expected one', async () => {
      const { store, projectId, assets } = make();
      const doc = timeline(projectId, assets);
      unwrap(await store.create(doc));
      const second = unwrap(await store.put(edited(doc, 90), 1));
      expect([second.revision, second.duration.value]).toEqual([2, 180]);
      const stale = await store.put(edited(doc, 30), 1);
      expect(!stale.ok && stale.error.code).toBe('core.conflict');
      const stored = unwrap(await store.get(doc.id));
      expect((stored.json as { revision: number }).revision).toBe(2);
      expect(stored.summary.revision).toBe(2);
      // Another id: the last character changed (a random ULID ends in Z one time in 32).
      const last = doc.id.endsWith('Z') ? 'Y' : 'Z';
      const missing = await store.put({ ...doc, id: `${doc.id.slice(0, -1)}${last}` as typeof doc.id }, 1);
      expect(!missing.ok && missing.error.code).toBe('core.not_found');
    });

    it('lists a project’s timelines, most recently changed first, and removes one', async () => {
      const { store, projectId, assets } = make();
      const a = timeline(projectId, assets, { name: 'A' });
      const b = timeline(projectId, assets, { name: 'B' });
      unwrap(await store.create(a));
      unwrap(await store.create(b));
      unwrap(await store.put(edited(a, 45), 1));
      expect(unwrap(await store.listByProject(projectId)).map((t) => t.name)).toEqual(['A', 'B']);
      unwrap(await store.remove(a.id));
      expect(unwrap(await store.listByProject(projectId)).map((t) => t.name)).toEqual(['B']);
      expect((await store.get(a.id)).ok).toBe(false);
    });
  });
}
