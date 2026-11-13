// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Reads the app's source for `<Button>` elements and says, for each, its English label and whether it carries an
 * icon. A small JSX-aware scan (braces, strings and nested tags), not a parser: good enough to keep the icon rule
 * honest (test/icon-verbs.test.ts), and to list the actions that are iconed in one place and not another.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface ScannedButton {
  readonly file: string;
  readonly line: number;
  /** The label in lower case, its ellipsis and spaces tidied: "try again", "add folder". */
  readonly label: string;
  readonly iconed: boolean;
}

/** Elements inside a button that are words or wrappers, not icons. */
const NOT_ICONS = new Set(['Trans', 'Plural', 'Select', 'SelectOrdinal', 'UserContent', 'Link', 'Fragment']);
/** The kit's own drawn marks that count as an icon. */
const KIT_ICONS = new Set(['AiMark', 'AiMarkIcon', 'ProviderLogo', 'FormatIcon', 'Tick', 'ConceptIcon']);

/** Every .tsx file under `dir`, skipping tests, previews and the dev kit's galleries. */
export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'node_modules' || name === 'dev' || name === 'kit-gallery') continue;
      out.push(...sourceFiles(path));
    } else if (/\.tsx$/.test(name) && !/\.(test|preview)\.tsx$|gallery\.tsx$|-kit\.tsx$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

/** The names a file imports from lucide-react (aliases resolved to the local name). */
function lucideNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/import\s*{([^}]*)}\s*from\s*'lucide-react'/g)) {
    for (const part of (match[1] ?? '').split(',')) {
      const local = part
        .replace(/\btype\s+/, '')
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (local) names.add(local);
    }
  }
  return names;
}

/** Where the tag opened at `from` ends: the index of its `>`, and whether it closes itself. */
function tagEnd(source: string, from: number): { end: number; selfClosing: boolean } {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === quote && source[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return { end: i, selfClosing: source[i - 1] === '/' };
  }
  return { end: source.length, selfClosing: true };
}

/** The words a button shows, from t`…`, <Trans>…</Trans> or plain text; markup and expressions dropped. */
function labelOf(body: string): string {
  const macro = /\bt`([^`]*)`/.exec(body)?.[1];
  const trans = /<Trans>([\s\S]*?)<\/Trans>/.exec(body)?.[1];
  const raw = macro ?? trans ?? body.replace(/{[^{}]*}/g, ' ').replace(/<[^>]*>/g, ' ');
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/\$?{[^}]*}/g, '')
    .replace(/…|\.\.\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Every `<Button>` in one file. */
export function scanSource(source: string, file: string): ScannedButton[] {
  const icons = lucideNames(source);
  const buttons: ScannedButton[] = [];
  const open = /<Button\b/g;
  for (let match = open.exec(source); match; match = open.exec(source)) {
    const start = match.index;
    const { end, selfClosing } = tagEnd(source, start + 1);
    const attrs = source.slice(start, end);
    let body = '';
    if (!selfClosing) {
      const close = source.indexOf('</Button>', end);
      body = close === -1 ? '' : source.slice(end + 1, close);
    }
    const tags = [...body.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)].map((m) => m[1] ?? '');
    const iconed =
      /\bicon=/.test(attrs) ||
      /<svg\b/.test(body) ||
      tags.some((tag) => icons.has(tag) || KIT_ICONS.has(tag) || /Icon$/.test(tag)) ||
      tags.some((tag) => !NOT_ICONS.has(tag) && /^[A-Z]/.test(tag) && /aria-hidden/.test(body));
    const label = labelOf(body || (/aria-label={t`([^`]*)`}/.exec(attrs)?.[1] ?? ''));
    if (!label) continue;
    const line = source.slice(0, start).split('\n').length;
    buttons.push({ file, line, label, iconed });
  }
  return buttons;
}

/** Every `<Button>` under the given roots, with paths relative to `base`. */
export function scanButtons(roots: readonly string[], base: string): ScannedButton[] {
  return roots.flatMap((root) =>
    sourceFiles(root).flatMap((path) => scanSource(readFileSync(path, 'utf8'), relative(base, path))),
  );
}

/** Labels shown both with an icon and without one somewhere: the inconsistent actions. */
export function inconsistent(
  buttons: readonly ScannedButton[],
): Map<string, { plain: number; iconed: number }> {
  const counts = new Map<string, { plain: number; iconed: number }>();
  for (const button of buttons) {
    const count = counts.get(button.label) ?? { plain: 0, iconed: 0 };
    if (button.iconed) count.iconed += 1;
    else count.plain += 1;
    counts.set(button.label, count);
  }
  return new Map([...counts].filter(([, count]) => count.plain > 0 && count.iconed > 0));
}
