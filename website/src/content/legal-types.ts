// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Fact } from './schema';

/**
 * The shape of a legal document (content/legal.ts and its Premium sections, content/legal-premium.ts): sections with
 * an anchor each, made of paragraphs, lists and facts. Text may carry links as `[label](href)`. Types only, in their
 * own file so the two content files can share them without importing each other.
 */

export type LegalBlock =
  | { readonly kind: 'p'; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly string[] }
  | { readonly kind: 'facts'; readonly facts: readonly Fact[] };

export interface LegalSection {
  /** The section's anchor (`/privacy/#waitlist`). */
  readonly id: string;
  readonly heading: string;
  readonly blocks: readonly LegalBlock[];
}

export interface LegalDoc {
  /** The visible line at the top: when it last changed. */
  readonly status: string;
  /** The answer-first sentence the page opens with. */
  readonly definition: string;
  readonly sections: readonly LegalSection[];
}

/** One row of the privacy notice's gist: its facts, said short, each from a section below (the icon is the section's). */
export interface GistRow {
  /** The section the row sums up, so the row links to it. */
  readonly section: string;
  readonly text: string;
}
