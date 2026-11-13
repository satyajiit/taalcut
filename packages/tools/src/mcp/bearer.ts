// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The bearer on every request (tools SPEC, "Sessions"): `Authorization: Bearer tcm_…`. Only its SHA-256 is ever
 * compared or kept; the comparison takes the same time whatever matches.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { MCP_TOKEN_PATTERN } from '@taalcut/core';

/** The token from an Authorization header, or undefined when it is missing or not a Taalcut bearer. */
export function bearerToken(header: string | readonly string[] | undefined): string | undefined {
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  const token = match?.[1];
  return token !== undefined && MCP_TOKEN_PATTERN.test(token) ? token : undefined;
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time equality of two hex hashes of the same length. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
