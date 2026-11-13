// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A path as a filter option value inside a filter graph: escaped once for
 * the option (`\`, `'`, `:`) and again for the graph description (`\`, `'`,
 * `[`, `]`, `,`, `;`), as FFmpeg's two-level quoting wants. For options that
 * name a file: `metadata=file=` (the analysis pass), `lut3d=file=` (render's
 * grade).
 */
export function filterPathArg(path: string): string {
  const option = path.replace(/[\\':]/gu, (char) => `\\${char}`);
  return option.replace(/[\\'[\],;]/gu, (char) => `\\${char}`);
}
