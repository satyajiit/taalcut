// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The modules an entry evaluates: its relative imports and re-exports, followed, without `import type`. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
const IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"](\.[^'"]+)['"]/gms;

function resolveModule(from: string, specifier: string): string {
  const target = resolve(dirname(from), specifier);
  if (target.endsWith('.ts')) return target;
  return existsSync(`${target}.ts`) ? `${target}.ts` : join(target, 'index.ts');
}

/** Paths under packages/core/src the entry (also under src) loads at runtime, e.g. 'basics/ids.ts'. */
export function runtimeModules(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [resolve(SRC, entry)];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT))
      if (match[1]) queue.push(resolveModule(file, match[1]));
  }
  return new Set([...seen].map((file) => relative(SRC, file)));
}
