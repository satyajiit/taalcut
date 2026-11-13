// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template v1 as JSON Schema, for the hub (Phase 3) and outside tools. The file
 * `schema/template.v1.schema.json` is this function's output, committed; a
 * test fails when they drift (`pnpm --filter @taalcut/templates run
 * schema:export` rewrites it).
 *
 * The schema describes the stored JSON, so it is the input side of
 * templateSchema (frame rates are stored as num/den and only reduced when
 * read). Ids are ULID strings. The cross-field rules (slots tile the template,
 * anchors land on their beats, …) are checked by templateSchema itself; JSON
 * Schema records the shapes.
 */
import { templateSchema, TEMPLATE_SCHEMA_VERSION, ULID_PATTERN } from '@taalcut/core';
import { z } from 'zod';

export const TEMPLATE_JSON_SCHEMA_FILE = `template.v${TEMPLATE_SCHEMA_VERSION}.schema.json`;

export function templateJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(templateSchema, {
    io: 'input',
    target: 'draft-2020-12',
    // Branded ids are z.custom (a ULID check); say what they are instead of dropping them.
    unrepresentable: 'any',
    override: (ctx) => {
      if ((ctx.zodSchema as { _zod: { def: { type: string } } })._zod.def.type === 'custom') {
        ctx.jsonSchema.type = 'string';
        ctx.jsonSchema.pattern = ULID_PATTERN.source;
      }
    },
  }) as Record<string, unknown>;
  return {
    $schema: generated.$schema,
    $id: `https://taalcut.app/schema/${TEMPLATE_JSON_SCHEMA_FILE}`,
    title: `Taalcut template, schema version ${TEMPLATE_SCHEMA_VERSION}`,
    description:
      'One immutable version of a template. Times are RationalTime { value, rate: { num, den } }; structure ' +
      'times are whole frames at canvas.rate, beats at beatMap.rate. Cross-field rules are checked by ' +
      '@taalcut/core templateSchema.',
    ...Object.fromEntries(Object.entries(generated).filter(([key]) => key !== '$schema')),
  };
}
