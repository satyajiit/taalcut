// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The hub CI applies the content rules exactly as the app's share check and the Worker do. fixtures/content-cases.json
 * holds what core's `hubContentProblems` reports for each document (packages/templates/test/hub/schema-drift.test.ts
 * keeps that table true to core); this file holds the CI to the same table.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { contentProblems } from '../scripts/lib/content-check.mjs';
import { schemaProblems } from '../scripts/lib/schema-check.mjs';
import { readJson } from './cli';
import { template } from './fixture';

interface ContentCase {
  readonly case: string;
  /** Core's schema refuses it (a `schema` problem). */
  readonly schema: boolean;
  /** Every other problem core reports, in order. */
  readonly problems: readonly { readonly path: string; readonly rule: string }[];
  readonly document: unknown;
}

const { cases } = readJson<{ cases: ContentCase[] }>(join(import.meta.dirname, 'fixtures'), 'content-cases.json');

const asCore = (problems: { jsonPath: string; rule: string }[]) =>
  problems.map(({ jsonPath, rule }) => ({ path: jsonPath, rule }));

describe('the CI content rules match core', () => {
  it.each(cases.map((item) => [item.case, item] as const))('%s', (_name, item) => {
    expect(asCore(contentProblems(item.document))).toEqual(item.problems);
    expect(schemaProblems(item.document).length > 0).toBe(item.schema);
  });

  it('measures the document as it serialises, as core does', () => {
    const large = { ...template(), padding: 'x '.repeat(70_000) };
    expect(asCore(contentProblems(large))).toContainEqual({ path: '', rule: 'tooLarge' });
  });

  it('stops at the problem limit', () => {
    const noisy = { ...template(), tags: Array.from({ length: 80 }, () => 'see www.example.com') };
    expect(contentProblems(noisy)).toHaveLength(50);
  });
});
