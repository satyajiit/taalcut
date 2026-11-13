// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TemplateStore's port semantics (core, templates/template-store.ts), as a
 * suite any implementation must pass: immutable versions with a head, a
 * conflict on a taken number or a moved head, findChild for redo.
 */
import { unwrap, type TemplateStore } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { nextVersion, template } from './documents';

const change = (key: string) => ({
  command: 'template.slot.rename',
  source: 'agent' as const,
  changeKey: key.repeat(64),
});
const meta = { name: 'Goa reel', projectId: null, listed: true };

export function templateStoreContract(name: string, make: () => TemplateStore): void {
  describe(`${name} honours the TemplateStore port`, () => {
    it('creates a lineage at version 1, its head, and refuses the same id twice', async () => {
      const store = make();
      const base = template();
      const doc = { ...base, slots: base.slots.map((slot, index) => ({ ...slot, approved: index === 0 })) };
      const made = unwrap(await store.create(doc, meta));
      expect(made).toMatchObject({
        id: doc.id,
        name: 'Goa reel',
        head: 1,
        origin: 'reference',
        slotCount: 3,
        bpm: 120,
      });
      expect(made).toMatchObject({
        platform: 'reels',
        listed: true,
        archived: false,
        contactSheet: {
          asset: 'a'.repeat(64),
          mediaType: 'image/jpeg',
          columns: 3,
          rows: 1,
          tile: { width: 120, height: 180 },
        },
        approvedSlots: 1,
      });
      // The list reads the same facts from the head's columns as get and create from its document.
      const listed = unwrap(
        await store.list({ includeUnlisted: false, includeArchived: false, limit: 10 }),
      ).items;
      expect(listed).toEqual([made]);
      expect(unwrap(await store.get(doc.id)).summary).toEqual(made);
      const stored = unwrap(await store.get(doc.id));
      expect([stored.version, stored.schemaVersion, stored.json]).toEqual([
        1,
        1,
        JSON.parse(JSON.stringify(doc)),
      ]);
      const twice = await store.create(doc, meta);
      expect(!twice.ok && twice.error.code).toBe('core.conflict');
    });

    it('adds immutable versions that become the head; a taken number is a conflict', async () => {
      const store = make();
      const v1 = template();
      unwrap(await store.create(v1, meta));
      const v2 = nextVersion(v1, 2, 1);
      expect(unwrap(await store.addVersion(v2, change('a'))).head).toBe(2);
      const taken = await store.addVersion(nextVersion(v1, 2, 1, 'other'), change('b'));
      expect(!taken.ok && taken.error.code).toBe('core.conflict');
      expect((await store.addVersion(nextVersion(v1, 4, 3), change('c'))).ok).toBe(false); // no parent 3
      expect(unwrap(await store.latestVersion(v1.id))).toBe(2);
      expect(
        (unwrap(await store.get(v1.id, 1)).json as { slots: { intent: { text: string } }[] }).slots[0]!.intent
          .text,
      ).toBe('wide beach at sunset');
      expect(
        unwrap(await store.versions(v1.id)).map((v) => [v.version, v.parentVersion, v.isHead, v.source]),
      ).toEqual([
        [1, null, false, null],
        [2, 1, true, 'agent'],
      ]);
    });

    it('moves the head only from the expected one, and finds a redo’s version again', async () => {
      const store = make();
      const v1 = template();
      unwrap(await store.create(v1, meta));
      unwrap(await store.addVersion(nextVersion(v1, 2, 1), change('a')));
      const stale = await store.setHead({ templateId: v1.id, version: 1, expectedHead: 1 });
      expect(!stale.ok && stale.error.code).toBe('core.conflict');
      expect(unwrap(await store.setHead({ templateId: v1.id, version: 1, expectedHead: 2 })).head).toBe(1); // undo
      expect(unwrap(await store.findChild(v1.id, 1, 'a'.repeat(64)))).toBe(2); // redo finds it
      expect(unwrap(await store.findChild(v1.id, 1, 'z'.repeat(64)))).toBeNull();
      expect(unwrap(await store.get(v1.id)).version).toBe(1);
    });

    it('changes names, listing and archive without a version, and removes the lineage', async () => {
      const store = make();
      const doc = template();
      unwrap(await store.create(doc, meta));
      const changed = unwrap(
        await store.setMeta(doc.id, { name: '  Monsoon  ', listed: false, archived: true }),
      );
      expect([changed.name, changed.listed, changed.archived, changed.head]).toEqual([
        'Monsoon',
        false,
        true,
        1,
      ]);
      expect(unwrap(await store.setMeta(doc.id, { archived: false })).archived).toBe(false);
      expect(unwrap(await store.usedBy(doc.id))).toBe(0);
      unwrap(await store.remove(doc.id));
      const gone = await store.get(doc.id);
      expect(!gone.ok && gone.error.code).toBe('core.not_found');
      expect((await store.remove(doc.id)).ok).toBe(false);
    });
  });
}
