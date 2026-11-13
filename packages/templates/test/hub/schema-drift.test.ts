// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * hub/ is the seed of the hub repository; its CI checks templates with the files in hub/schema, which
 * scripts/export-hub-schema.ts generates from core. Each committed file must be exactly what the script writes
 * today (a missing file is a failed export, not a skipped check), and the content-rule cases the hub CI is held to
 * (hub/test/fixtures/content-cases.json) must be what core's hubContentProblems reports.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hubContentProblems, hubTemplateV0Schema } from '@taalcut/core';
import { hubSchemaFiles, hubSchemaText } from '../../scripts/export-hub-schema';
import { sharedDocument } from './helpers';

const HUB = new URL('../../../../hub/', import.meta.url);

function committed(rel: string): string {
  const url = new URL(rel, HUB);
  expect(existsSync(url), `missing hub/${rel}: run pnpm --filter @taalcut/templates hub:schema:export`).toBe(true);
  return readFileSync(url, 'utf8');
}

interface ContentCase {
  readonly case: string;
  readonly schema: boolean;
  readonly problems: readonly { readonly path: string; readonly rule: string }[];
  readonly document: unknown;
}

const { cases } = JSON.parse(committed('test/fixtures/content-cases.json')) as { cases: ContentCase[] };

describe('hub schema drift', () => {
  it.each(hubSchemaFiles().map((file) => [file.name, file] as const))(
    'hub/schema/%s is what core generates',
    (name, file) => {
      expect(committed(`schema/${name}`)).toBe(hubSchemaText(file));
    },
  );

  it('accepts a document the app shares', () => {
    expect(hubTemplateV0Schema.safeParse(sharedDocument().doc).success).toBe(true);
  });

  it.each(cases.map((item) => [item.case, item] as const))(
    'the hub CI case "%s" is what core reports',
    (_name, item) => {
      const problems = hubContentProblems(item.document);
      expect(problems.some((problem) => problem.rule === 'schema')).toBe(item.schema);
      expect(problems.filter((problem) => problem.rule !== 'schema')).toEqual(item.problems);
    },
  );
});
