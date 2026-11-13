// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What an id is: the brand, the ULID check and its zod schemas. No error model, so schema modules (and
 * @taalcut/core/hub, which reaches them) have no side effect; making and parsing ids is ids.ts.
 */
import { isValid } from 'ulid';
import { z } from 'zod';

declare const idBrand: unique symbol;
export type Id<Entity extends string> = string & { readonly [idBrand]: Entity };

/** A ULID's shape: 26 characters of Crockford's base 32, upper case (what newId makes). */
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isId(value: unknown): value is Id<string> {
  return typeof value === 'string' && isValid(value);
}

/** zod schema for an id in an IPC contract or stored JSON: rejects anything that isn't a ULID. */
export function idSchema<Entity extends string>(): z.ZodType<Id<Entity>> {
  return z.custom<Id<Entity>>(isId, { message: 'Expected a ULID' });
}

/**
 * A branded id as a plain ULID string, for model-facing schemas (tool and skill inputs and outputs) that must
 * convert to JSON Schema: `idSchema` is a custom check, which can't. The bus validates the payload with
 * `idSchema` again on dispatch.
 */
export function ulidSchema<Entity extends string>(entity: Entity): z.ZodType<Id<Entity>, string> {
  return z.string().regex(ULID_PATTERN).describe(`${entity} id`) as unknown as z.ZodType<Id<Entity>, string>;
}
