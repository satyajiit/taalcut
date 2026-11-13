// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Writes the hub repository seed's schema files from core (P3-B12, contract round P3-2): the hub template's and
 * the index's JSON Schema, and the content rules as data, so the hub CI checks exactly what the app's share check
 * and the Worker check. test/hub/schema-drift.test.ts fails when a committed file differs from what this writes.
 * Run: pnpm --filter @taalcut/templates hub:schema:export
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  HUB_CONTENT_RULES,
  HUB_DOCUMENT_RULES,
  HUB_FORMAT_VERSION,
  HUB_ID_PATHS,
  HUB_ID_PATTERN,
  HUB_MAX_BYTES,
  hubIndexSchema,
  hubProblemSchema,
  hubTemplateV0Schema,
  MAX_HUB_PROBLEMS,
} from '@taalcut/core/hub';
import { z } from 'zod';

const SCHEMA_DIR = new URL('../../../hub/schema/', import.meta.url);
const SCHEMA_BASE = 'https://taalcut.app/schema/';

/** One file of hub/schema: its name there and its JSON. */
export interface HubSchemaFile {
  readonly name: string;
  readonly json: unknown;
}

function jsonSchema(schema: z.ZodType, name: string, title: string, description: string) {
  const { $schema, ...rest } = z.toJSONSchema(schema, {
    unrepresentable: 'throw',
    target: 'draft-2020-12',
    io: 'input',
  });
  return { $schema, $id: `${SCHEMA_BASE}${name}`, title, description, ...rest };
}

function contentRules() {
  return {
    formatVersion: HUB_FORMAT_VERSION,
    maxBytes: HUB_MAX_BYTES,
    maxProblems: MAX_HUB_PROBLEMS,
    maxPathLength: hubProblemSchema.shape.path.maxLength,
    documentRules: [...HUB_DOCUMENT_RULES],
    idPaths: [...HUB_ID_PATHS],
    idPattern: { pattern: HUB_ID_PATTERN.source, flags: HUB_ID_PATTERN.flags },
    rules: HUB_CONTENT_RULES.map(({ id, pattern, flags }) => ({ id, pattern, flags })),
  };
}

/** Every file the hub CI reads from hub/schema, generated from @taalcut/core/hub. */
export function hubSchemaFiles(): HubSchemaFile[] {
  return [
    {
      name: 'hub-template.v0.schema.json',
      json: jsonSchema(
        hubTemplateV0Schema,
        'hub-template.v0.schema.json',
        'Taalcut hub template v0',
        'Generated from @taalcut/core hubTemplateV0Schema. Rules JSON Schema cannot state (reduced rates, boxes inside the frame, the text style count, a name that is not blank, slot tiling) are checked by the hub validator.',
      ),
    },
    {
      name: 'hub-index.v0.schema.json',
      json: jsonSchema(
        hubIndexSchema,
        'hub-index.v0.schema.json',
        'Taalcut hub index v0',
        'Generated from @taalcut/core hubIndexSchema. build-index.mjs refuses to publish an index the app would not read.',
      ),
    },
    { name: 'content-rules.v0.json', json: contentRules() },
  ];
}

/** The file's bytes as committed: two-space JSON and a final newline. */
export function hubSchemaText(file: HubSchemaFile): string {
  return `${JSON.stringify(file.json, null, 2)}\n`;
}

function main(): void {
  for (const file of hubSchemaFiles()) {
    const out = fileURLToPath(new URL(file.name, SCHEMA_DIR));
    writeFileSync(out, hubSchemaText(file));
    process.stdout.write(`wrote ${out}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
