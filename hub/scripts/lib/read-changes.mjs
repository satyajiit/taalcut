// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE_JSON = /^templates\/(?:[^/]+\/)*[^/]+\.json$/;

export function packageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function isTemplateJson(rel) {
  return TEMPLATE_JSON.test(rel);
}

export function asRelative(root, input) {
  const absolute = path.isAbsolute(input) ? input : path.resolve(root, input);
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return input.split(path.sep).join('/');
  return relative.split(path.sep).join('/');
}

export function readChangedList(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function listTemplateJson(root) {
  const dir = path.join(root, 'templates');
  const found = [];
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.name.endsWith('.json')) found.push(absolute);
    }
  };
  walk(dir);
  return found.sort();
}

export function expectedTemplatePath(id) {
  return `templates/${id.slice(0, 2)}/${id}.json`;
}
