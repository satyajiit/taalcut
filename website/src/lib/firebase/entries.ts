// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { PlatformId } from '#content/schema';
import { EMAIL_MAX, emailProblem, normalizeEmail } from '#lib/email';

/**
 * The documents in Firestore, built and checked before any SDK loads. firebase/firestore.rules checks the same shapes
 * on the server (firebase/test/rules.test.ts holds the two together), and firebase/DATA.md says what each field is
 * for and how long it is kept. The site writes contact messages only. The waitlist closed with the first release
 * (November 2026): no page writes an entry any more, and its shape stays here because the entries made before then
 * are kept until their email is sent, and the rules and their test still describe them.
 */

/** The wording someone agreed to when they joined. */
export const CONSENT_VERSION = 'waitlist-2026-11';

/** What people said they make: an optional choice on the waitlist's form, stored as the id. */
export const MAKES = ['travel', 'food', 'product', 'fitness', 'day-in-life', 'other'] as const;
export type Make = (typeof MAKES)[number];

/** Where a sign-up came from: a short tag from `?ref=` or the section. The rules hold the same pattern. */
export const SOURCE_PATTERN = /^[a-z0-9-]{1,40}$/;
export const SOURCE_MAX = 40;

/** The platforms in the order the form listed them. */
export const PLATFORM_IDS: readonly PlatformId[] = ['macos', 'ubuntu', 'windows'];

/**
 * A source tag safe to store: lowercase, a–z, 0–9 and single hyphens, at most 40 characters. `IG Story!` becomes
 * `ig-story`. Null when nothing usable is left.
 */
export function sanitizeSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const tag = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SOURCE_MAX)
    .replace(/^-+|-+$/g, '');
  return SOURCE_PATTERN.test(tag) ? tag : null;
}

/** Platforms as stored: known ids only, each once, in the form's order. */
export function normalizePlatforms(platforms: readonly string[]): PlatformId[] {
  return PLATFORM_IDS.filter((p) => platforms.includes(p));
}

export function isMake(value: unknown): value is Make {
  return typeof value === 'string' && (MAKES as readonly string[]).includes(value);
}

export interface WaitlistEntry {
  readonly email: string;
  readonly platforms: readonly PlatformId[];
  readonly make: Make | null;
  readonly source: string;
  readonly consentVersion: typeof CONSENT_VERSION;
}

/** A waitlist document (without `createdAt`, which the server stamps), or null when the address won't pass. */
export function waitlistEntry(input: {
  readonly email: string;
  readonly platforms: readonly string[];
  readonly make: string | null;
  readonly source: string;
}): WaitlistEntry | null {
  if (emailProblem(input.email)) return null;
  return {
    email: normalizeEmail(input.email),
    platforms: normalizePlatforms(input.platforms),
    make: isMake(input.make) ? input.make : null,
    source: sanitizeSource(input.source) ?? 'site',
    consentVersion: CONSENT_VERSION,
  };
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Contact                                                                                                          */
/* ---------------------------------------------------------------------------------------------------------------- */

/** The contact page's five topics, each stored under its own name (firebase/firestore.rules lists the same five). */
export const CONTACT_TOPICS = ['hello', 'press', 'privacy', 'security', 'broken'] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

export const CONTACT_LIMITS = { name: 80, email: EMAIL_MAX, message: 2000 } as const;

export interface ContactEntry {
  readonly name: string;
  readonly email: string;
  readonly topic: ContactTopic;
  readonly message: string;
}

export type ContactField = 'name' | 'email' | 'message';
export type ContactProblem = 'empty' | 'too-long' | 'malformed';

export function isContactTopic(value: unknown): value is ContactTopic {
  return typeof value === 'string' && (CONTACT_TOPICS as readonly string[]).includes(value);
}

/** Each field's problem, in the form's order; empty when the message may be sent. */
export function contactProblems(input: {
  readonly name: string;
  readonly email: string;
  readonly message: string;
}): [ContactField, ContactProblem][] {
  const found: [ContactField, ContactProblem][] = [];
  const name = input.name.trim();
  if (name.length === 0) found.push(['name', 'empty']);
  else if (name.length > CONTACT_LIMITS.name) found.push(['name', 'too-long']);
  const email = emailProblem(input.email);
  if (email) found.push(['email', email]);
  const message = input.message.trim();
  if (message.length === 0) found.push(['message', 'empty']);
  else if (message.length > CONTACT_LIMITS.message) found.push(['message', 'too-long']);
  return found;
}

/** The contact document (without `createdAt`), or null while a field has a problem. */
export function contactEntry(input: {
  readonly name: string;
  readonly email: string;
  readonly topic: string;
  readonly message: string;
}): ContactEntry | null {
  if (contactProblems(input).length > 0) return null;
  return {
    name: input.name.trim(),
    email: normalizeEmail(input.email),
    topic: isContactTopic(input.topic) ? input.topic : 'hello',
    message: input.message.trim(),
  };
}
