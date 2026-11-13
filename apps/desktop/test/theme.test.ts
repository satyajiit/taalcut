// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANVAS, canvasColour, chromeColours, SYMBOLS } from '../src/main/theme-preferences';

const repoRoot = join(import.meta.dirname, '..', '..', '..');

describe('canvas colours', () => {
  it('match the generated theme-meta.json, wherever the design track keeps it', () => {
    const found = globSync('**/theme-meta.json', {
      cwd: repoRoot,
      exclude: (path) => /(^|\/)(node_modules|out|release|dist|\.claude)$/.test(path),
    });
    expect(found.length, 'theme-meta.json not found; update CANVAS and this test').toBeGreaterThan(0);
    for (const file of found) {
      const meta = JSON.parse(readFileSync(join(repoRoot, file), 'utf8')) as { canvas: typeof CANVAS };
      expect(meta.canvas, file).toEqual(CANVAS);
    }
  });

  it('picks dark or light', () => {
    expect(canvasColour(true)).toBe(CANVAS.dark);
    expect(canvasColour(false)).toBe(CANVAS.light);
    expect(chromeColours(true)).toEqual({ background: CANVAS.dark, symbols: SYMBOLS.dark });
    expect(chromeColours(false)).toEqual({ background: CANVAS.light, symbols: SYMBOLS.light });
  });

  it('draws the system’s window controls in ink-2, as design/tokens/tokens.json has it', () => {
    type Token = { $value: { hex: string } };
    const tokens = JSON.parse(readFileSync(join(repoRoot, 'design', 'tokens', 'tokens.json'), 'utf8')) as {
      color: Record<'light' | 'dark', Record<string, Token>>;
    };
    expect(SYMBOLS).toEqual({
      light: tokens.color.light['ink-2']?.$value.hex,
      dark: tokens.color.dark['ink-2']?.$value.hex,
    });
  });
});
