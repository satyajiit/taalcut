// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Id } from '@taalcut/core';
import { notFound } from '@tanstack/react-router';

/**
 * A ULID, by the same rule as core's isId (ulid's isValid: 26 Crockford base-32
 * characters, any case). Checked here rather than with core's parseId because
 * route params parse in the entry chunk, and core's runtime brings zod with it;
 * test/route-id.test.ts keeps the two in step.
 */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/**
 * Parses an id from the URL into the entity's branded id type. A malformed id
 * is a page that can't exist, so it shows the not-found page, not an error.
 *
 *   params: { parse: ({ assetId }) => ({ assetId: routeId<'Asset'>(assetId) }) }
 */
export function routeId<Entity extends string>(value: string): Id<Entity> {
  if (!ULID.test(value)) throw notFound();
  return value as Id<Entity>;
}

/** An optional id in the search string: the branded id, or undefined when it is missing or malformed. */
export function searchId<Entity extends string>(value: unknown): Id<Entity> | undefined {
  return typeof value === 'string' && ULID.test(value) ? (value as Id<Entity>) : undefined;
}
