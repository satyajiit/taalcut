// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { goldenJsonSchema, parseGoldenReel } from '../src/schema';

const here = dirname(fileURLToPath(import.meta.url));
const goldenDir = join(here, '../golden/sample');
const schemaPath = join(here, '../schema/golden.schema.json');

function reel(name: string): unknown {
  return JSON.parse(readFileSync(join(goldenDir, name), 'utf8')) as unknown;
}

describe('golden reel schema', () => {
  it('accepts the three synthetic samples', () => {
    const english = parseGoldenReel(reel('sample-en-30.json'));
    const hindi = parseGoldenReel(reel('sample-hi-2997.json'));
    const spanish = parseGoldenReel(reel('sample-es-25.json'));
    expect(english.synthetic).toBe(true);
    expect(hindi.languages).toEqual(['hi', 'en']);
    expect(spanish.languages).toEqual(['es', 'pt-BR']);
    expect(spanish.audio.type).toBe('music');
  });

  it('keeps a rational frame rate as exact integers', () => {
    const hindi = parseGoldenReel(reel('sample-hi-2997.json'));
    expect(hindi.frameRate).toEqual({ numerator: 30000, denominator: 1001 });
    expect(Number.isSafeInteger(hindi.frameRate.numerator)).toBe(true);
    expect(Number.isSafeInteger(hindi.frameRate.denominator)).toBe(true);
  });

  it('rejects a float frame rate such as 29.97', () => {
    const sample = reel('sample-hi-2997.json') as { frameRate: { numerator: number } };
    sample.frameRate.numerator = 29.97;
    expect(() => parseGoldenReel(sample)).toThrow(/int/i);
  });

  it('rejects cuts that are not strictly increasing or that fall outside the reel', () => {
    const decreasing = reel('sample-es-25.json') as { cuts: number[] };
    decreasing.cuts = [150, 50];
    expect(() => parseGoldenReel(decreasing)).toThrow(/strictly increasing/);

    const pastEnd = reel('sample-es-25.json') as { cuts: number[] };
    pastEnd.cuts = [50, 250];
    expect(() => parseGoldenReel(pastEnd)).toThrow(/inside/);
  });

  it('exports JSON Schema that names the frame-rate integers and the cut list', () => {
    const exported = `${JSON.stringify(goldenJsonSchema(), null, 2)}\n`;
    expect(exported).toBe(readFileSync(schemaPath, 'utf8'));
    expect(exported).toContain('numerator');
    expect(exported).toContain('denominator');
    expect(exported).toContain('cuts');
  });
});
