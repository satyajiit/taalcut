// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The prompt-injection fence (P1-G6), shared by the agent and models (P3-V20's translator, P3-B15): text from
 * media, references, captions or files reaches a model only inside <untrusted source="…"> blocks, with any
 * look-alike tag inside it defused so it can't close the block early.
 */

/**
 * Invisible format characters (Unicode Cf: zero-width spaces and joiners, word joiners, soft hyphens, bidi
 * controls). A model that skips them would read `</` + U+200B + `untrusted>` as a closing tag, so untrusted text loses
 * them.
 */
const FORMAT_CHARACTERS = /\p{Cf}/gu;

/** Defuses anything inside untrusted text that looks like an <untrusted> or </untrusted> tag. */
export function escapeUntrusted(text: string): string {
  return text.replace(FORMAT_CHARACTERS, '').replace(/<(\s*\/?\s*untrusted)/gi, '‹$1');
}

/** The text as one fenced block; `source` keeps only letters, digits, '.', '_' and '-'. */
export function wrapUntrusted(text: string, source: string): string {
  const safeSource = source.replace(/[^a-z0-9._-]/gi, '-') || 'unknown';
  return `<untrusted source="${safeSource}">\n${escapeUntrusted(text)}\n</untrusted>`;
}
