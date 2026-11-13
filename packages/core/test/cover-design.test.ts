// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { coverDesignSchema, coverSettingsSchema } from '@taalcut/core';

const box = { x: 0.1, y: 0.3, width: 0.8, height: 0.2 };
const palette = { ink: '#111111', paper: '#FFF1D0', accent: '#FF681F', muted: '#999999' };
const headline = { kind: 'text', box, text: 'Never gets old.', fontSize: 0.12 };
const design = { version: 1, palette, layers: [headline] };

describe('authored cover design', () => {
  it('retains existing frame covers and permits authored solid or photographic covers', () => {
    const cover = { aspect: '9:16', source: { kind: 'frame', frame: 12 } };
    expect(coverSettingsSchema.parse(cover).design).toBeUndefined();
    expect(coverSettingsSchema.parse({ ...cover, design }).design?.layers[0]?.kind).toBe('text');
    expect(coverSettingsSchema.safeParse({ ...cover, source: { kind: 'solid' } }).success).toBe(false);
    expect(coverSettingsSchema.parse({ ...cover, source: { kind: 'solid' }, design }).source.kind).toBe(
      'solid',
    );
  });

  it('bounds layers, positions and paint without accepting executable markup', () => {
    for (const invalid of [
      { ...design, palette: { ...palette, accent: 'url(https://example.com)' } },
      { ...design, layers: Array.from({ length: 17 }, () => headline) },
      { ...design, layers: [{ ...headline, font: 'arbitrary-font' }] },
      { ...design, layers: [{ ...headline, box: { ...box, x: 0.5 } }] },
      { ...design, layers: [{ ...headline, fontSize: Number.POSITIVE_INFINITY }] },
    ])
      expect(coverDesignSchema.safeParse(invalid).success).toBe(false);
  });

  it('accepts a bounded flight path while rejecting raw SVG and malformed starts', () => {
    const path = {
      kind: 'path',
      box,
      dashed: true,
      commands: [
        { command: 'M', x: 0, y: 1 },
        { command: 'Q', cx: 0.6, cy: 0.8, x: 1, y: 0 },
      ],
    };
    expect(coverDesignSchema.safeParse({ ...design, layers: [path] }).success).toBe(true);
    for (const commands of [
      [{ command: 'L', x: 0, y: 1 }, { command: 'Z' }],
      [
        { command: 'M', x: 0, y: 1 },
        { command: 'script', text: 'alert(1)' },
      ],
      Array.from({ length: 65 }, () => ({ command: 'M', x: 0, y: 0 })),
    ])
      expect(coverDesignSchema.safeParse({ ...design, layers: [{ ...path, commands }] }).success).toBe(false);
  });
});
