// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Fact } from '#content/schema';
import { absolute } from '#lib/seo';

/**
 * Markdown helpers for the mirrors and llms.txt. Content text may already carry links as `[label](href)`; site paths
 * in them become absolute, so a mirror read on its own still links back to the site.
 */

/** Content text with its site-relative links made absolute. */
export function inline(text: string): string {
  return text.replace(/\]\((\/[^)]*)\)/g, (_m, href: string) => `](${absolute(href)})`);
}

/** Content text with its `[label](href)` links reduced to the label (for JSON-LD and plain text). */
export function plain(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

export function heading(level: 1 | 2 | 3, text: string): string {
  return `${'#'.repeat(level)} ${text}`;
}

/** Facts as a list a reader and an engine both take as plain statements. */
export function facts(list: readonly Fact[]): string {
  return list.map(([label, value]) => `- **${label}:** ${inline(value)}`).join('\n');
}

export function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${inline(item)}`).join('\n');
}

export function link(label: string, path: string): string {
  return `[${label}](${absolute(path)})`;
}

/** Blocks joined by one blank line, empty ones dropped, ending with a newline. */
export function doc(...blocks: readonly (string | false | undefined)[]): string {
  return `${blocks.filter((b): b is string => typeof b === 'string' && b.length > 0).join('\n\n')}\n`;
}
