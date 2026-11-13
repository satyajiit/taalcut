// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The packaged app has no copy of the scopes main inlines (app-files.ts INLINED_SCOPES), so a bundle that
 * loads one of them at run time would fail there, and crash reporting would quietly stay off. tsdown.config.ts
 * runs assertInlined on every main and utility chunk; the build fails instead.
 */
import { INLINED_SCOPES } from './app-files';

export interface ChunkLike {
  readonly type: string;
  readonly fileName: string;
  readonly code?: string;
  readonly imports?: readonly string[];
  readonly dynamicImports?: readonly string[];
}

/** Static and dynamic imports, require() and rolldown's __require() of a module, in a chunk's code. */
const SPECIFIERS = /(?:\bfrom\s*|(?:require|import)\s*\(\s*)["']([^"']+)["']/g;

function inScope(specifier: string, scopes: readonly string[]): boolean {
  return scopes.some((scope) => specifier.startsWith(`${scope}/`));
}

/** `<chunk>: <specifier>` for each import of the given scopes left for run time. */
export function runtimeImportsOf(
  chunks: readonly ChunkLike[],
  scopes: readonly string[] = INLINED_SCOPES,
): string[] {
  const found = new Set<string>();
  for (const chunk of chunks) {
    if (chunk.type !== 'chunk') continue;
    const fromCode = [...(chunk.code ?? '').matchAll(SPECIFIERS)].map((match) => match[1] ?? '');
    for (const specifier of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? []), ...fromCode]) {
      if (inScope(specifier, scopes)) found.add(`${chunk.fileName}: ${specifier}`);
    }
  }
  return [...found].sort();
}

export function assertInlined(chunks: readonly ChunkLike[]): void {
  const imports = runtimeImportsOf(chunks);
  if (imports.length === 0) return;
  throw new Error(
    `These bundles load ${INLINED_SCOPES.join(' or ')} at run time, but app.asar ships no copy ` +
      `(packaging/app-files.ts): ${imports.join(', ')}. Bundle them (tsdown.config.ts) instead.`,
  );
}
