// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The phone page can't reach design/tokens (the lan process serves a fixed asset map from the phone folder, and
// a packaged app ships only that folder), so it carries tokens.css and base.css as exact copies. These checks
// keep the copies exact and keep the page's own stylesheets on the tokens: no colour, face or radius of their own.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const OWN = ['app.css', 'controls.css', 'rows.css'] as const;
const own = OWN.map((name) => [name, withoutComments(read(`../../phone/styles/${name}`))] as const);
const TOKENS = withoutComments(read('../../../../design/tokens/tokens.css'));

/** Declarations outside @font-face blocks, as [property, value]. */
function declarations(css: string): Array<readonly [string, string]> {
  const outside = css.replace(/@font-face\s*{[^}]*}/g, '');
  return [...outside.matchAll(/(?:^|[;{\s])(-{0,2}[a-z][\w-]*)\s*:\s*([^;{}]+);/g)].map(
    (match) => [match[1] ?? '', (match[2] ?? '').trim()] as const,
  );
}

describe('the phone page tokens', () => {
  it('serves design/tokens/tokens.css and base.css byte for byte', () => {
    expect(read('../../phone/styles/tokens.css')).toBe(read('../../../../design/tokens/tokens.css'));
    expect(read('../../phone/styles/base.css')).toBe(read('../../../../design/tokens/base.css'));
  });

  it('loads the token sheets before its own, in the page', () => {
    const html = read('../../phone/index.html');
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="\/assets\/([\w.-]+)"/g)].map((m) => m[1]);
    expect(sheets).toEqual(['tokens.css', 'base.css', 'app.css', 'controls.css', 'rows.css']);
  });

  it('paints every colour through a token: no raw colour anywhere in its own sheets', () => {
    const colour = /oklch\(|rgba?\(|hsla?\(|#[0-9a-f]{3,8}\b|\b(?:white|black)\b/i;
    for (const [name, css] of own) {
      const values = declarations(css);
      expect(values.length, name).toBeGreaterThan(20);
      const raw = values.filter(([, value]) => colour.test(value)).map(([prop, value]) => `${prop}: ${value}`);
      expect(raw, name).toEqual([]);
    }
  });

  it('declares no --color-* of its own and uses only tokens that exist', () => {
    const names = (css: string) => [...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1] ?? '');
    // The page's own layout variables (--gutter, --surface-control…) and the ones set at run time: the bar's
    // --progress through the CSSOM, the count-in's --dx and --dy per arc, the top bar's measured --bar-block.
    const runtime = ['--progress', '--bar-block'];
    const defined = new Set([...names(TOKENS), ...own.flatMap(([, css]) => names(css)), ...runtime]);
    for (const [name, css] of own) {
      expect(names(css).filter((token) => token.startsWith('--color-')), name).toEqual([]);
      const used = [...css.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1] ?? '');
      expect(used.filter((token) => !defined.has(token)), name).toEqual([]);
    }
  });

  it('sets every face through the font tokens: Onest and JetBrains Mono, never a system face', () => {
    for (const [name, css] of own) {
      for (const [prop, value] of declarations(css)) {
        if (prop === 'font-family') expect(value, name).toMatch(/^var\(--font-(?:sans|mono|display|body)\)$/);
        if (prop === 'font') expect(value, name).toMatch(/var\(--font-(?:sans|mono)\)$/);
      }
      expect(css, name).not.toMatch(/system-ui|-apple-system|Segoe UI|Roboto|Helvetica|Arial/);
    }
  });

  it('rounds only with the radius tokens and animates only transform and opacity', () => {
    for (const [name, css] of own) {
      for (const [prop, value] of declarations(css)) {
        if (prop === 'border-radius' && value !== 'inherit') expect(value, name).toMatch(/^var\(--radius-[\w]+\)$/);
      }
      for (const block of css.matchAll(/@keyframes\s+[\w-]+\s*{([\s\S]*?)}\s*}/g)) {
        const props = [...(block[1] ?? '').matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]);
        expect(props.every((prop) => prop === 'transform' || prop === 'opacity'), `${name} ${block[0]}`).toBe(true);
      }
    }
  });
});
