// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The longest address the waitlist takes (RFC 5321's path limit), matched by firestore.rules. */
export const EMAIL_MAX = 254;

/** Lowercase and trimmed: the waitlist's document id, so one person is one entry. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * A plain check that catches typos without rejecting real addresses: one @, something before it, a dot in the domain,
 * no spaces, no slash (a Firestore id can't hold one). The rules run the same pattern.
 */
export const EMAIL_PATTERN = /^[^\s@/]+@[^\s@/]+\.[^\s@/.]{2,}$/;

export type EmailProblem = 'empty' | 'too-long' | 'malformed';

export function emailProblem(raw: string): EmailProblem | null {
  const email = normalizeEmail(raw);
  if (email.length === 0) return 'empty';
  if (email.length > EMAIL_MAX) return 'too-long';
  if (!EMAIL_PATTERN.test(email)) return 'malformed';
  return null;
}
