// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The app's faces (src/fonts/fonts.css, DESIGN.md Typography): the fallbacks are written by hand so each family
// ships only its own script and is scaled to Onest. These checks keep them honest against the Fontsource packages
// they come from, and against the font stacks in the design tokens.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cssFamily, FAMILIES } from '../src/features/type-specimen/families';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const FONTS_CSS = readFileSync(here('../src/fonts/fonts.css'), 'utf8');
const TOKENS = readFileSync(here('../../../design/tokens/tokens.css'), 'utf8');
/** The package as the renderer depends on it. */
const packageFile = (specifier: string) => here(`../node_modules/${specifier}`);

interface Face {
  family: string;
  src: string;
  range: string;
  sizeAdjust: string | undefined;
}

const faces: Face[] = [...FONTS_CSS.matchAll(/@font-face\s*{([^}]*)}/g)].map((match) => {
  const body = match[1] ?? '';
  return {
    family: /font-family:\s*'([^']+)'/.exec(body)?.[1] ?? '',
    src: /url\('([^']+)'\)/.exec(body)?.[1] ?? '',
    range: (/unicode-range:\s*([^;]+);/.exec(body)?.[1] ?? '').replace(/\s+/g, ''),
    sizeAdjust: /size-adjust:\s*([^;]+);/.exec(body)?.[1],
  };
});

/** Every family a token stack names, in order. */
function stack(token: string): string[] {
  const value = new RegExp(`${token}:\\s*([^;]+);`).exec(TOKENS)?.[1] ?? '';
  return value.split(',').map((family) => family.trim().replace(/"/g, ''));
}

/** The unicode-range Fontsource gives one file in its own stylesheet. */
function fontsourceRange(src: string): string {
  const [scope = '', name = '', , file = ''] = src.split('/');
  const css = readFileSync(packageFile(`${scope}/${name}/wght.css`), 'utf8');
  const block = new RegExp(`url\\(\\./files/${file.replace(/\./g, '\\.')}\\)[^}]*unicode-range:\\s*([^;]+);`).exec(
    css,
  );
  return (block?.[1] ?? '').replace(/\s+/g, '');
}

describe('the app’s fonts', () => {
  it('loads Onest and JetBrains Mono from their Fontsource stylesheets', () => {
    expect(FONTS_CSS).toContain("@import '@fontsource-variable/onest/wght.css';");
    expect(FONTS_CSS).toContain("@import '@fontsource-variable/jetbrains-mono/wght.css';");
    expect(stack('--font-sans')[0]).toBe('Onest Variable');
    expect(stack('--font-mono')[0]).toBe('JetBrains Mono Variable');
  });

  it('points every fallback at a file the package ships, with the range Fontsource gives it', () => {
    expect(faces.length).toBeGreaterThan(12);
    for (const face of faces) {
      expect(face.src, face.family).toMatch(/^@fontsource-variable\/noto-sans[\w-]*\/files\/[\w-]+\.woff2$/);
      expect(existsSync(packageFile(face.src)), face.src).toBe(true);
      expect(face.range, face.src).toBe(fontsourceRange(face.src));
    }
  });

  it('scales every fallback to Onest’s x-height', () => {
    for (const face of faces) expect(face.sizeAdjust, face.src).toBe('98.3%');
  });

  it('declares a face for every Noto family the stacks name, and nothing they don’t', () => {
    const named = new Set(
      [...stack('--font-sans'), ...stack('--font-mono')].filter((family) => family.startsWith('Noto Sans')),
    );
    expect([...new Set(faces.map((face) => face.family))].sort()).toEqual([...named].sort());
  });

  it('ends both stacks in the system’s own fonts, so CJK and anything unshipped still draws', () => {
    expect(stack('--font-sans')).toEqual(expect.arrayContaining(['system-ui', 'sans-serif']));
    expect(stack('--font-mono').at(-1)).toBe('monospace');
  });

  it('gives /dev/type the bytes each family really adds', () => {
    const sizes = new Map<string, number>();
    const add = (family: string, file: string) =>
      sizes.set(family, (sizes.get(family) ?? 0) + statSync(packageFile(file)).size);
    for (const face of faces) add(face.family, face.src);
    for (const [family, name] of [
      ['Onest Variable', 'onest'],
      ['JetBrains Mono Variable', 'jetbrains-mono'],
    ] as const) {
      const css = readFileSync(packageFile(`@fontsource-variable/${name}/wght.css`), 'utf8');
      for (const [, file] of css.matchAll(/url\(\.\/files\/([\w.-]+)\)/g))
        add(family, `@fontsource-variable/${name}/files/${file}`);
    }
    expect(Object.fromEntries(FAMILIES.map((family) => [cssFamily(family), family.bytes]))).toEqual(
      Object.fromEntries(sizes),
    );
  });
});
