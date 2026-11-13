// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * ICU MessageFormat checks for catalogue strings.
 *
 * Lingui 6 stores plurals as ICU in a single msgstr, not gettext msgstr[n].
 * `lingui extract` rewrites catalogues and has no --check. `--clean` drops obsolete messages.
 * https://lingui.dev/ref/cli
 * https://lingui.dev/guides/message-format
 * https://lingui.dev/ref/catalog-formats
 *
 * Parsed with @messageformat/parser (installed via @lingui/message-utils). No new dependency.
 * Cardinal categories: plurals.ts, from the Unicode CLDR chart
 * https://www.unicode.org/cldr/charts/47/supplemental/language_plural_rules.html
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Finding } from './finding.ts';
import { displayPath, localesDir, SOURCE_LOCALE } from './paths.ts';
import { cardinalCategories, type PluralCategory } from './plurals.ts';
import { listCatalogueFiles, parsePo, PoSyntaxError } from './po.ts';

const KNOWN_FUNCTIONS = new Set(['number', 'date', 'time', 'spellout', 'ordinal', 'duration']);

interface IcuCase {
  key: string;
  tokens: IcuNode[];
}

type IcuNode =
  | { type: 'content' }
  | { type: 'argument'; arg: string }
  | { type: 'octothorpe' }
  | { type: 'function'; arg: string; key: string; param?: IcuNode[] }
  | { type: 'plural' | 'select' | 'selectordinal'; arg: string; cases: IcuCase[] };

interface ParserModule {
  parse(src: string, options?: { cardinal?: string[]; strictPluralKeys?: boolean }): IcuNode[];
}

let parser: ParserModule | undefined;

function isParser(value: unknown): value is ParserModule {
  if (typeof value !== 'object' || value === null || !('parse' in value)) return false;
  return typeof value.parse === 'function';
}

function loadParser(): ParserModule {
  if (parser) return parser;
  const rendererJson = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'apps/renderer/package.json',
  );
  const corePkg = createRequire(rendererJson).resolve('@lingui/core/package.json');
  // message-utils has no "." export. compileMessage is the subpath that sits next to the parser.
  const utilsEntry = createRequire(corePkg).resolve('@lingui/message-utils/compileMessage');
  const loaded: unknown = createRequire(utilsEntry)('@messageformat/parser');
  if (!isParser(loaded)) throw new Error('Could not load @messageformat/parser from @lingui/message-utils.');
  parser = loaded;
  return loaded;
}

function parseMessage(text: string, categories: readonly PluralCategory[] | undefined): IcuNode[] {
  const options = categories
    ? { cardinal: [...categories], strictPluralKeys: true }
    : { strictPluralKeys: false };
  return loadParser().parse(text, options);
}

function walk(nodes: IcuNode[], visit: (node: IcuNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.type === 'function' && node.param) walk(node.param, visit);
    if (node.type === 'plural' || node.type === 'select' || node.type === 'selectordinal') {
      for (const item of node.cases) walk(item.tokens, visit);
    }
  }
}

function pluralProblems(node: { cases: IcuCase[] }, locale: string): string[] {
  const categories = cardinalCategories(locale);
  if (!categories) return [`no CLDR cardinal rules for ${locale}`];
  const present = node.cases.map((item) => item.key).filter((key) => !key.startsWith('='));
  const allowed = new Set<string>(categories);
  const problems: string[] = [];
  for (const category of categories) {
    if (!present.includes(category)) problems.push(`plural is missing "${category}"`);
  }
  for (const key of present) {
    if (!allowed.has(key)) problems.push(`plural category "${key}" is not used in ${locale}`);
  }
  return problems;
}

/** Syntax and plural-category errors. Empty input is not a message. */
export function validateMessage(text: string, locale: string): string[] {
  if (text === '') return [];
  let nodes: IcuNode[];
  try {
    nodes = parseMessage(text, cardinalCategories(locale));
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : 'unreadable ICU';
    return [`broken ICU syntax: ${detail}`];
  }
  const problems: string[] = [];
  walk(nodes, (node) => {
    if (node.type === 'function' && !KNOWN_FUNCTIONS.has(node.key)) {
      problems.push(`unknown ICU type "${node.key}"`);
    }
    if (node.type === 'plural') problems.push(...pluralProblems(node, locale));
    if (
      (node.type === 'select' || node.type === 'selectordinal') &&
      !node.cases.some((item) => item.key === 'other')
    ) {
      problems.push(`${node.type} is missing "other"`);
    }
  });
  return problems;
}

export function placeholderNames(text: string): Set<string> | undefined {
  let nodes: IcuNode[];
  try {
    nodes = parseMessage(text, undefined);
  } catch {
    return undefined;
  }
  const names = new Set<string>();
  walk(nodes, (node) => {
    if (
      node.type === 'argument' ||
      node.type === 'function' ||
      node.type === 'plural' ||
      node.type === 'select' ||
      node.type === 'selectordinal'
    ) {
      names.add(node.arg);
    }
  });
  return names;
}

export function checkIcu(root: string, dir: string = localesDir(root)): Finding[] {
  const findings: Finding[] = [];
  for (const { locale, file } of listCatalogueFiles(dir)) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'could not read catalogue';
      findings.push({ file: displayPath(root, file), line: 1, id: '', message });
      continue;
    }
    let parsed;
    try {
      parsed = parsePo(text);
    } catch (error) {
      const line = error instanceof PoSyntaxError ? error.line : 1;
      const message = error instanceof Error ? error.message : 'could not parse catalogue';
      findings.push({ file: displayPath(root, file), line, id: '', message });
      continue;
    }
    const shown = displayPath(root, file);
    for (const entry of parsed.entries) {
      for (const message of validateMessage(entry.id, SOURCE_LOCALE)) {
        findings.push({ file: shown, line: entry.line, id: entry.id, message });
      }
      const sameEnglish = locale === SOURCE_LOCALE && entry.msgstr === entry.id;
      if (entry.msgstr !== '' && !sameEnglish) {
        for (const message of validateMessage(entry.msgstr, locale)) {
          findings.push({ file: shown, line: entry.msgstrLine, id: entry.id, message });
        }
      }
    }
  }
  return findings;
}
