// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync, writeFileSync } from 'node:fs';

import { type Finding } from './finding.ts';
import { readJsonObject } from './json-object.ts';
import { cataloguePath, displayPath, frozenPath, SOURCE_LOCALE } from './paths.ts';
import { englishSource, entryKey, parsePo, type PoEntry } from './po.ts';

const UNFREEZE = 'If the change is deliberate, run `pnpm i18n:unfreeze` and commit frozen-ids.json with it.';

function sortKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function readManifest(
  text: string,
): { ok: true; map: Record<string, string> } | { ok: false; message: string } {
  const parsed = readJsonObject(
    text,
    'frozen-ids.json is not valid JSON',
    'frozen-ids.json must be an object of message id to English source',
  );
  if (!parsed.ok) return parsed;
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.value)) {
    if (typeof value !== 'string') return { ok: false, message: `frozen id ${key} is not a string` };
    map[key] = value;
  }
  return { ok: true, map };
}

export function manifestFromEntries(
  entries: PoEntry[],
): { ok: true; json: string } | { ok: false; message: string } {
  const map = new Map<string, string>();
  for (const entry of entries) {
    const key = entryKey(entry);
    const english = englishSource(entry);
    // Lingui keeps an explicit id apart from a source sentence with the same words (the plugin catalogue's
    // `API key` and the settings' "API key"), so the catalogue lists both. Agreeing, they are one frozen fact.
    const frozen = map.get(key);
    if (frozen !== undefined && frozen !== english)
      return { ok: false, message: `message id ${key} has two English sources` };
    map.set(key, english);
  }
  const ordered: Record<string, string> = {};
  for (const key of sortKeys([...map.keys()])) {
    const value = map.get(key);
    if (value !== undefined) ordered[key] = value;
  }
  return { ok: true, json: `${JSON.stringify(ordered, null, 2)}\n` };
}

function lineOfKey(text: string, key: string): number {
  const needle = `${JSON.stringify(key)}:`;
  const lines = text.split('\n');
  const index = lines.findIndex((line) => line.includes(needle));
  return index === -1 ? 1 : index + 1;
}

export function checkFreeze(root: string): Finding[] {
  const file = frozenPath(root);
  const shown = displayPath(root, file);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [{ file: shown, line: 1, id: '', message: `frozen-ids.json is missing. ${UNFREEZE}` }];
  }
  const manifest = readManifest(text);
  if (!manifest.ok) return [{ file: shown, line: 1, id: '', message: manifest.message }];
  let entries: PoEntry[];
  try {
    entries = parsePo(readFileSync(cataloguePath(root, SOURCE_LOCALE), 'utf8')).entries;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'could not read the English catalogue';
    return [{ file: displayPath(root, cataloguePath(root, SOURCE_LOCALE)), line: 1, id: '', message }];
  }
  const current = new Map<string, string>();
  for (const entry of entries) current.set(entryKey(entry), englishSource(entry));
  const findings: Finding[] = [];
  for (const key of sortKeys(Object.keys(manifest.map))) {
    const frozen = manifest.map[key];
    const live = current.get(key);
    if (live === undefined) {
      findings.push({
        file: shown,
        line: lineOfKey(text, key),
        id: key,
        message: `removed or reworded after the string freeze (the English text is the id). ${UNFREEZE}`,
      });
    } else if (live !== frozen) {
      findings.push({
        file: shown,
        line: lineOfKey(text, key),
        id: key,
        message: `English source changed. ${UNFREEZE}`,
      });
    }
  }
  return findings;
}

export function writeManifest(root: string): { ok: true; count: number } | { ok: false; message: string } {
  let entries: PoEntry[];
  try {
    entries = parsePo(readFileSync(cataloguePath(root, SOURCE_LOCALE), 'utf8')).entries;
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'could not read the English catalogue',
    };
  }
  const built = manifestFromEntries(entries);
  if (!built.ok) return built;
  writeFileSync(frozenPath(root), built.json);
  return { ok: true, count: entries.length };
}
