// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cell, compareText } from './format.mjs';

/**
 * manifest.example.json is placeholder data, excluded on purpose.
 * manifest.schema.json is the JSON Schema, not a list of components.
 */
const SKIP = new Set(['manifest.example.json', 'manifest.schema.json']);

const NO_URL = '(no url)';
const NO_ATTRIBUTION = '(no attribution)';

function componentsOf(json, file) {
  if (Array.isArray(json.components)) return json.components;
  if (json.manifest && Array.isArray(json.manifest.components)) return json.manifest.components;
  throw new Error(`${file} has no components array`);
}

function rowFrom(component, file) {
  const licence = component.licence;
  const spdx = licence && typeof licence.spdx === 'string' ? licence.spdx.trim() : '';
  const id = typeof component.id === 'string' ? component.id.trim() : '';
  const version = typeof component.version === 'string' ? component.version.trim() : '';
  if (!id || !version || !spdx)
    throw new Error(`${file} has a component missing id, version, or licence.spdx`);
  const noticeUrl = licence?.notice?.url;
  const url = typeof noticeUrl === 'string' && noticeUrl.trim() !== '' ? noticeUrl.trim() : NO_URL;
  const attribution =
    licence && typeof licence.attribution === 'string' && licence.attribution.trim() !== ''
      ? licence.attribution.trim()
      : NO_ATTRIBUTION;
  return {
    id,
    name: cell(component.name ?? ''),
    kind: cell(component.kind ?? ''),
    version,
    spdx,
    url: cell(url),
    attribution: cell(attribution),
  };
}

/**
 * Every manifest in the directory except the example and the schema.
 * Provisional and signed copies of the same id+version+spdx count once.
 * Filename order decides which copy wins when the other fields differ.
 * The npm allowlist does not apply: a GPL sidecar stays, with its real SPDX.
 */
export function loadComponents(dir) {
  const files = readdirSync(dir)
    .filter((name) => name.startsWith('manifest') && name.endsWith('.json') && !SKIP.has(name))
    .sort((left, right) => compareText(left, right));
  if (files.length === 0) throw new Error(`No component manifests in ${dir}`);
  const byKey = new Map();
  for (const file of files) {
    let json;
    try {
      json = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not parse ${file} (${reason})`, { cause: error });
    }
    for (const component of componentsOf(json, file)) {
      const row = rowFrom(component, file);
      const key = `${row.id}\0${row.version}\0${row.spdx}`;
      if (!byKey.has(key)) byKey.set(key, row);
    }
  }
  return [...byKey.values()].sort(
    (left, right) =>
      compareText(left.id, right.id) ||
      compareText(left.version, right.version) ||
      compareText(left.spdx, right.spdx),
  );
}
