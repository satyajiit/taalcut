// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Tools as the model sees them. Callers describe arguments with zod (the tool
 * registry's schemas, PRD 7.2); pi-ai wants JSON Schema, which zod 4 emits
 * with z.toJSONSchema. pi-ai's TypeBox type is only a JSON Schema object with
 * extra typing, so the plain schema is passed through as is.
 */
import type { Tool as PiTool } from '@earendil-works/pi-ai';
import { err, ok, ValidationError, type Result } from '@taalcut/core';
import { z } from 'zod';
import type { ToolCall } from './messages';

export interface ToolSpec<Schema extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly description: string;
  /** Arguments schema. Must describe a JSON object. */
  readonly parameters: Schema;
  /** Ask the provider to enforce the schema while sampling, where it can. */
  readonly strict?: boolean;
}

/** JSON Schema for a tool's arguments, without the `$schema` marker providers don't expect. */
export function toolJsonSchema(spec: ToolSpec): Record<string, unknown> {
  const schema = z.toJSONSchema(spec.parameters, { io: 'input', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
  const { $schema: _ignored, ...rest } = schema;
  if (rest.type !== 'object') throw new Error(`Tool '${spec.name}' parameters must be a zod object schema.`);
  return rest;
}

/**
 * The most items an array bound may ask of the embedded runtime's grammar. llama-server samples tool calls under a
 * grammar built from every offered schema, and its parser refuses a large repetition: measured on runtime b11571,
 * `maxItems` 1,000 passes for numbers, strings and objects, and 2,000 fails for each.
 */
export const EMBEDDED_MAX_ITEMS = 1_000;

/**
 * A tool schema as the embedded runtime gets it: an array bound over EMBEDDED_MAX_ITEMS is left out, nothing else
 * changes. 0.1.0's installed run: `audio.critique` takes up to 2,000 cuts, and every request that offered it
 * ended with "400: Failed to initialize samplers: failed to parse grammar", so the make stopped at the reviewer's
 * first turn. The bound is a sampling aid there, not the check: the tool's own schema still validates every call.
 */
export function embeddedToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const relaxed = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(relaxed);
    if (value === null || typeof value !== 'object') return value;
    const entries = Object.entries(value).filter(
      ([key, bound]) => !(key === 'maxItems' && typeof bound === 'number' && bound > EMBEDDED_MAX_ITEMS),
    );
    return Object.fromEntries(entries.map(([key, child]) => [key, relaxed(child)]));
  };
  return relaxed(schema) as Record<string, unknown>;
}

/** `embedded`: the request goes to the runtime Taalcut runs itself, whose grammar holds smaller bounds. */
export function toPiTools(specs: readonly ToolSpec[], embedded = false): PiTool[] {
  return specs.map((spec) => {
    const schema = toolJsonSchema(spec);
    return {
      name: spec.name,
      description: spec.description,
      parameters: (embedded ? embeddedToolSchema(schema) : schema) as unknown as PiTool['parameters'],
      ...(spec.strict ? { constrainedSampling: { type: 'json_schema', strict: 'prefer' } as const } : {}),
    };
  });
}

/**
 * Validates a tool call from the model against its spec. A failure is a value,
 * not a throw: the agent sends the message back to the model so it can retry.
 */
export function parseToolCall<Schema extends z.ZodType>(
  spec: ToolSpec<Schema>,
  call: ToolCall,
): Result<z.infer<Schema>> {
  if (call.name !== spec.name) {
    return err(
      ValidationError({ field: 'name' }, { detail: `Expected tool ${spec.name}, got ${call.name}` }),
    );
  }
  const parsed = spec.parameters.safeParse(call.arguments);
  if (parsed.success) return ok(parsed.data as z.infer<Schema>);
  return err(ValidationError({ field: spec.name }, { detail: z.prettifyError(parsed.error) }));
}
