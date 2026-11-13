// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-T1: stored JSON is read through the migration chain; a newer shape is refused; a synthetic v2 round-trips. */
import { describe, expect, it } from 'vitest';
import { templateSchema } from '@taalcut/core';
import { z } from 'zod';
import { createMigrator, migrateTemplate, TEMPLATE_MIGRATIONS } from '../src/index';
import { json, referenceTemplate } from './helpers/fixtures';

describe('migrateTemplate', () => {
  it('reads a v1 document unchanged (v1 ships an empty chain)', () => {
    const template = referenceTemplate();
    const read = migrateTemplate(json(template), 1);
    expect(read.ok && read.value).toEqual(templateSchema.parse(json(template)));
    expect(Object.keys(TEMPLATE_MIGRATIONS)).toEqual([]);
  });

  it('refuses a newer schemaVersion than this build knows, never guessing', () => {
    const stored = { ...(json(referenceTemplate()) as object), schemaVersion: 2 };
    const read = migrateTemplate(stored, 2);
    expect(!read.ok && read.error).toMatchObject({
      code: 'templates.unsupported_schema',
      params: { schemaVersion: 2 },
    });
  });

  it.each([
    ['a version below 1', json(referenceTemplate()), 0],
    [
      'a label that disagrees with the document',
      { ...(json(referenceTemplate()) as object), schemaVersion: 1 },
      1.5,
    ],
    ['an array', [], 1],
    ['a broken document', { ...(json(referenceTemplate()) as object), slots: [] }, 1],
  ])('refuses %s as core.validation', (_name, stored, schemaVersion) => {
    const read = migrateTemplate(stored, schemaVersion);
    expect(!read.ok && read.error.code).toBe('core.validation');
  });

  it('refuses a document labelled with another version than it states', () => {
    const read = migrateTemplate({ ...(json(referenceTemplate()) as object), schemaVersion: 1 }, 1);
    expect(read.ok).toBe(true);
    const mislabelled = createMigrator({ current: 2, migrations: {}, schema: z.unknown() });
    const result = mislabelled.migrate({ schemaVersion: 2 }, 1);
    expect(!result.ok && result.error.code).toBe('core.validation');
  });

  describe('a synthetic v2', () => {
    /** v2 adds a required `title`; everything else is v1. */
    const v2Schema = z
      .object({ schemaVersion: z.literal(2), title: z.string().min(1) })
      .loose()
      .superRefine((document, ctx) => {
        const { title: _title, ...rest } = document;
        const v1 = templateSchema.safeParse({ ...rest, schemaVersion: 1 });
        if (!v1.success) ctx.addIssue({ code: 'custom', message: 'Not a v1 body' });
      });
    const migrator = createMigrator({
      current: 2,
      migrations: {
        1: (document) => {
          const text = document.text as { text: string }[];
          return { ...document, title: text[0]?.text ?? 'Untitled' };
        },
      },
      schema: v2Schema,
    });

    it('migrates v1 on read and round-trips as v2', () => {
      const stored = json(referenceTemplate());
      const snapshot = JSON.stringify(stored);
      const migrated = migrator.migrate(stored, 1);
      expect(migrated.ok && migrated.value).toMatchObject({ schemaVersion: 2, title: 'Goa' });
      // Read is pure: the stored document is untouched until a new version is written.
      expect(JSON.stringify(stored)).toBe(snapshot);
      const again = migrator.migrate(json(migrated.ok && migrated.value), 2);
      expect(again.ok && again.value).toEqual(migrated.ok && migrated.value);
    });

    it('refuses a v3 and a chain with a gap', () => {
      expect(migrator.migrate({ schemaVersion: 3 }, 3).ok).toBe(false);
      const gap = createMigrator({ current: 3, migrations: { 1: (d) => d }, schema: z.unknown() });
      const result = gap.migrate({ schemaVersion: 1 }, 1);
      expect(!result.ok && result.error.code).toBe('templates.unsupported_schema');
    });
  });
});
