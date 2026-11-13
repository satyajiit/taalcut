// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Taalcut's faces on the phone: the woff2 files are the Fontsource packages' own subsets, copied byte for byte
// (with their OFL licences), every @font-face points at a file the server serves, and the one preloaded file is
// one of them. Nothing comes from a CDN.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHONE_PAGE_FILES } from '../../src/phone-assets';

const phone = (path: string) => new URL(`../../phone/${path}`, import.meta.url);
/** The package as this one depends on it (packages/transfer/package.json lists all three). */
const packageDir = (name: string) => fileURLToPath(new URL(`../../node_modules/${name}/`, import.meta.url));
const FONTS = [
  ['@fontsource-variable/onest', 'onest-latin-wght-normal.woff2'],
  ['@fontsource-variable/onest', 'onest-latin-ext-wght-normal.woff2'],
  ['@fontsource-variable/jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2'],
  ['@fontsource-variable/noto-sans-devanagari', 'noto-sans-devanagari-devanagari-wght-normal.woff2'],
] as const;
const LICENCES = [
  ['@fontsource-variable/onest', 'OFL-onest.txt'],
  ['@fontsource-variable/jetbrains-mono', 'OFL-jetbrains-mono.txt'],
  ['@fontsource-variable/noto-sans-devanagari', 'OFL-noto-sans-devanagari.txt'],
] as const;
const CSS = readFileSync(phone('styles/app.css'), 'utf8');
const HTML = readFileSync(phone('index.html'), 'utf8');
const SERVED = new Map(PHONE_PAGE_FILES.map(([name, path, type]) => [name, { path, type }]));

describe('the phone page fonts', () => {
  it('ships each Fontsource subset byte for byte, served as font/woff2', () => {
    for (const [pkg, file] of FONTS) {
      const copy = readFileSync(phone(`fonts/${file}`));
      expect(copy.equals(readFileSync(join(packageDir(pkg), 'files', file))), file).toBe(true);
      const served = [...SERVED.entries()].find(([, entry]) => entry.path === `fonts/${file}`);
      expect(served?.[1].type, file).toBe('font/woff2');
    }
  });

  it('ships the SIL Open Font License of every face beside the files', () => {
    for (const [pkg, file] of LICENCES) {
      const licence = readFileSync(phone(`fonts/${file}`), 'utf8');
      expect(licence).toBe(readFileSync(join(packageDir(pkg), 'LICENSE'), 'utf8'));
      expect(licence).toContain('SIL Open Font License');
    }
  });

  it('points every @font-face at a served file, swaps while loading, and declares the families the tokens use', () => {
    const faces = [...CSS.matchAll(/@font-face\s*{([^}]*)}/g)].map((match) => match[1] ?? '');
    expect(faces).toHaveLength(FONTS.length);
    const families = new Set<string>();
    for (const face of faces) {
      expect(face).toContain('font-display: swap');
      expect(face).toMatch(/unicode-range:/);
      const url = /url\('\/assets\/([\w.-]+)'\)/.exec(face)?.[1] ?? '';
      expect(SERVED.get(url)?.type, url).toBe('font/woff2');
      families.add(/font-family:\s*'([^']+)'/.exec(face)?.[1] ?? '');
    }
    const tokens = readFileSync(phone('styles/tokens.css'), 'utf8');
    for (const family of families) expect(tokens, family).toContain(`"${family}"`);
    expect(CSS).not.toMatch(/url\((?!'\/assets\/)/);
  });

  it('preloads Onest from the Mac and asks no other host for anything', () => {
    const preload = /<link rel="preload" href="\/assets\/([\w.-]+)" as="font" type="font\/woff2" crossorigin \/>/.exec(
      HTML,
    );
    expect(preload?.[1]).toBe('onest-latin.woff2');
    expect(HTML).not.toMatch(/(?:src|href)="(?:https?:)?\/\//);
  });
});
