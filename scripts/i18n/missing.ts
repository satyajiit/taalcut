// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Finding } from './finding.ts';
import { readJsonObject } from './json-object.ts';
import { displayPath, localesDir, PSEUDO_LOCALE, SOURCE_LOCALE } from './paths.ts';
import { listCatalogueFiles, parsePo, PoSyntaxError } from './po.ts';

export const STATUSES = ['draft', 'in-review', 'signed-off'] as const;

export type CatalogueStatus = (typeof STATUSES)[number];

export interface MissingResult {
  exitCode: number;
  errors: Finding[];
  warnings: Finding[];
}

function isStatus(value: unknown): value is CatalogueStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export function readStatus(
  text: string,
): { ok: true; status: Record<string, CatalogueStatus> } | { ok: false; message: string } {
  const parsed = readJsonObject(
    text,
    'status.json is not valid JSON',
    'status.json must be an object of locale to draft, in-review, or signed-off',
  );
  if (!parsed.ok) return parsed;
  const status: Record<string, CatalogueStatus> = {};
  for (const [locale, value] of Object.entries(parsed.value)) {
    if (!isStatus(value))
      return { ok: false, message: `status.json: ${locale} is not draft, in-review, or signed-off` };
    status[locale] = value;
  }
  return { ok: true, status };
}

export function checkMissing(
  root: string,
  statusText: string,
  dir: string = localesDir(root),
): MissingResult {
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const statusFile = displayPath(root, join(dir, 'status.json'));
  const parsedStatus = readStatus(statusText);
  if (!parsedStatus.ok) {
    errors.push({ file: statusFile, line: 1, id: '', message: parsedStatus.message });
    return { exitCode: 1, errors, warnings };
  }
  for (const { locale, file } of listCatalogueFiles(dir)) {
    if (locale === SOURCE_LOCALE || locale === PSEUDO_LOCALE) continue;
    const shown = displayPath(root, file);
    const level = parsedStatus.status[locale];
    if (!level) {
      errors.push({ file: shown, line: 1, id: '', message: `locale ${locale} has no status.json entry` });
      continue;
    }
    let po;
    try {
      po = parsePo(readFileSync(file, 'utf8'));
    } catch (error) {
      const line = error instanceof PoSyntaxError ? error.line : 1;
      const message = error instanceof Error ? error.message : 'could not parse catalogue';
      errors.push({ file: shown, line, id: '', message });
      continue;
    }
    for (const entry of po.entries) {
      if (entry.msgstr !== '') continue;
      const finding: Finding = {
        file: shown,
        line: entry.line,
        id: entry.id,
        message: 'missing translation',
      };
      if (level === 'signed-off') errors.push(finding);
      else warnings.push(finding);
    }
  }
  return { exitCode: errors.length > 0 ? 1 : 0, errors, warnings };
}
