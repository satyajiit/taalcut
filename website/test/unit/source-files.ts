// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const REPO_ROOT = join(SITE_ROOT, '..');

/** Every file under a site directory, relative to the site, filtered by extension. */
export function filesUnder(dir: string, extensions: readonly string[]): string[] {
  const root = join(SITE_ROOT, dir);
  const found: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (extensions.some((e) => name.endsWith(e))) found.push(relative(SITE_ROOT, full));
    }
  };
  walk(root);
  return found.sort();
}

export function read(path: string): string {
  return readFileSync(join(SITE_ROOT, path), 'utf8');
}

/**
 * The words a visitor reads in a TSX file: JSX text between tags and string literals in user-facing attributes
 * (aria-label, alt, title, placeholder). Comments, class names and code are left out.
 */
export function visibleText(source: string): string[] {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const texts: string[] = [];
  // `(?<![=-])`: an arrow's `>` (`=>`, `->`) never opens text.
  // A generic's `>` (`useState<number>(`) can run to the next tag through statements: those are code, never text.
  for (const m of noComments.matchAll(/(?<![=-])>([^<>{}]*[A-Za-z][^<>{}]*)</g)) {
    if (!/\b(const|let|return)\s|[!=]==|\?\./.test(m[1]!)) texts.push(m[1]!.trim());
  }
  for (const m of noComments.matchAll(/\b(?:aria-label|alt|title|placeholder)=["']([^"']+)["']/g)) texts.push(m[1]!);
  return texts.filter((t) => t.length > 0);
}

/**
 * The string literals in a source file that read as prose: they start with a capital letter, hold a curly
 * apostrophe or run from one sentence into the next, the way sentences, labels and headings do; class names, ids and
 * keys never do. Comments and import
 * paths are left out. This catches the words visibleText can't see: props, constants and ternaries.
 */
export function proseLiterals(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    .replace(/^\s*(import|export)\b[^;]*\bfrom\s+['"][^'"]+['"];?/gm, '');
  const texts: string[] = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const text = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    // A literal that runs over a line or holds code (an arrow, a call, a statement) is the scanner pairing two
    // quotes across code, never prose.
    if (/\n|=>|[;{}]|\)\./.test(text.replace(/\$\{[^{}]*\}/g, 'x'))) continue;
    if (/^[A-Z]/.test(text) || /’/.test(text) || /[a-z][.!?:]\s+[A-Z]/.test(text)) texts.push(text);
  }
  return texts;
}
