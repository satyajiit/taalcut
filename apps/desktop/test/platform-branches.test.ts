// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Seam 2 (plan/linux-round-1.md): no file in apps/desktop/src outside src/platform/ branches on the OS. What counts
 * as a branch: reading process.platform or os.platform(), comparing with an OS name ('darwin', 'linux', 'win32',
 * …), or a table keyed by one. Comments don't count. A file that has to know the OS asks the platform services
 * (src/platform/types.ts) instead.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');

const OS = '(?:darwin|linux|win32|freebsd|openbsd|netbsd|aix|sunos|cygwin|android)';
const BRANCHES: readonly RegExp[] = [
  /\bprocess\.platform\b/,
  /\bos\.platform\s*\(/,
  /import\s*\{[^}]*\bplatform\b[^}]*\}\s*from\s*['"](?:node:)?os['"]/,
  new RegExp(`[=!]==?\\s*['"]${OS}['"]`),
  new RegExp(`['"]${OS}['"]\\s*[=!]==?`),
  // A table keyed by OS name: `darwin: …` or `'win32': …` as an object key.
  new RegExp(`(?:^|[{,]\\s*)['"]?${OS}['"]?\\s*:(?!:)`, 'm'),
];

/** The source without comments (good enough for this check: a `//` inside a string only hides the rest of that line). */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx|mts|cts)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

const posix = (path: string) => path.split(sep).join('/');

function branching(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sources(SRC)) {
    const path = posix(relative(SRC, file));
    if (path.startsWith('platform/')) continue;
    const text = code(readFileSync(file, 'utf8'));
    const lines = text
      .split('\n')
      .flatMap((line, i) =>
        BRANCHES.some((pattern) => pattern.test(line)) ? [`${i + 1}: ${line.trim()}`] : [],
      );
    if (lines.length > 0) found.set(path, lines);
  }
  return found;
}

describe('platform branches', () => {
  it('appear only in src/platform/', () => {
    expect(Object.fromEntries(branching()), 'ask the platform services (src/platform) instead').toEqual({});
  });

  it('catches the shapes a branch takes, and not a comment about one', () => {
    const hits = (text: string) => BRANCHES.some((pattern) => pattern.test(code(text)));
    expect(hits("if (process.platform !== 'darwin') app.quit();")).toBe(true);
    expect(hits("const mac = os.platform() === 'darwin';")).toBe(true);
    expect(hits("import { platform, tmpdir } from 'node:os';")).toBe(true);
    expect(hits("return info?.platform === 'darwin';")).toBe(true);
    expect(hits('const PROBES = {\n  darwin: (dir) => mac(dir),\n};')).toBe(true);
    expect(hits("const T = { 'win32': 1 };")).toBe(true);
    expect(hits('// on darwin the lights are hidden; process.platform is read in platform/')).toBe(false);
    expect(hits('/* win32: later */ const x = 1;')).toBe(false);
    expect(hits("const url = 'https://example.com/linux';")).toBe(false);
    expect(hits('const label = platform.name;')).toBe(false);
  });
});
