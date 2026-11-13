// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-T1: the committed JSON Schema is templateSchema's, and it describes stored templates. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ULID_PATTERN } from '@taalcut/core';
import { TEMPLATE_JSON_SCHEMA_FILE, templateJsonSchema } from '../src/index';
import { json, referenceTemplate } from './helpers/fixtures';

const committed = () =>
  JSON.parse(
    readFileSync(new URL(`../schema/${TEMPLATE_JSON_SCHEMA_FILE}`, import.meta.url), 'utf8'),
  ) as Record<string, unknown>;

describe('template JSON Schema', () => {
  it('matches the committed file (run schema:export after a schema change)', () => {
    expect(committed()).toEqual(templateJsonSchema());
  });

  it('names its draft, its id and every top-level field of a stored template', () => {
    const schema = templateJsonSchema();
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toMatch(/template\.v1\.schema\.json$/);
    const properties = Object.keys(schema.properties as object);
    // BRK1's doubts are optional: a stored template without any leaves the key out.
    const optional = ['doubts', 'subjects', 'graphics'];
    expect(properties.sort()).toEqual(
      [...Object.keys(json(referenceTemplate()) as object), ...optional].sort(),
    );
    expect(schema.required).not.toContain('doubts');
  });

  it('describes ids as ULID strings rather than leaving them open', () => {
    const id = (templateJsonSchema().properties as Record<string, Record<string, unknown>>).id;
    expect(id).toEqual({ type: 'string', pattern: ULID_PATTERN.source });
    expect(ULID_PATTERN.test((json(referenceTemplate()) as { id: string }).id)).toBe(true);
  });
});
