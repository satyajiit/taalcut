// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * JSON Schema export for model tool-calling (z.toJSONSchema). Input schemas
 * use zod's input side ('io: input'), so fields with defaults are optional
 * for the model, as they are for the parser.
 */
import { attempt, type AnyTool, type Result } from '@taalcut/core';
import { z } from 'zod';

export type JsonSchema = Record<string, unknown>;
export type JsonSchemaTarget = 'draft-2020-12' | 'draft-07' | 'openapi-3.0';
export const DEFAULT_SCHEMA_TARGET: JsonSchemaTarget = 'draft-2020-12';

export interface ToolJsonSchemas {
  readonly input: JsonSchema;
  readonly output: JsonSchema;
}

/** What the model gets for a tool it chose to load: name, description and parameters. */
export interface ToolSchema {
  readonly name: string;
  readonly callName: string;
  readonly version: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
}

/** Fails (with the reason in `detail`) when a schema can't be expressed in JSON Schema, e.g. z.date(). */
export function exportToolSchemas(spec: AnyTool, target: JsonSchemaTarget): Result<ToolJsonSchemas> {
  return attempt(() => ({
    input: convert(spec.input, target, 'input'),
    output: convert(spec.output, target, 'output'),
  }));
}

function convert(schema: z.ZodType, target: JsonSchemaTarget, io: 'input' | 'output'): JsonSchema {
  const json = z.toJSONSchema(schema, { target, io, unrepresentable: 'throw' }) as JsonSchema;
  // '$schema' costs tokens on every call and providers ignore it.
  delete json.$schema;
  return json;
}
