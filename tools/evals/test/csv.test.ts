// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCsv, reelsFromCsv, reelsToCsv } from '../src/csv';
import { parseGoldenReel } from '../src/schema';

const here = dirname(fileURLToPath(import.meta.url));
const goldenDir = join(here, '../golden/sample');

describe('csv', () => {
  it('keeps commas and quotes inside quoted fields', () => {
    const table = parseCsv('record_type,note\nreel,"hello, ""world"""\n');
    expect(table[1]).toEqual(['reel', 'hello, "world"']);
  });

  it('round-trips the labeller sheet into the three sample reels', () => {
    const fromSheet = reelsFromCsv(readFileSync(join(goldenDir, 'sheet.csv'), 'utf8'));
    const fromJson = ['sample-en-30.json', 'sample-hi-2997.json', 'sample-es-25.json'].map((name) =>
      parseGoldenReel(JSON.parse(readFileSync(join(goldenDir, name), 'utf8')) as unknown),
    );
    expect(fromSheet).toEqual(fromJson);
    expect(reelsFromCsv(reelsToCsv(fromJson))).toEqual(fromJson);
  });

  it('names the reel when a child row arrives before its reel row', () => {
    const header =
      'record_type,reel_id,synthetic,note,source_label,source_uri,duration_frames,width,height,fps_numerator,fps_denominator,audio_type,languages,frame,kind,slot_id,start_frame,end_frame,intent,overlay_id,text,x,y,w,h';
    expect(() => reelsFromCsv(`${header}\ncut,missing,,,,,,,,,,,,,,,,\n`)).toThrow(/no reel row for missing/);
  });
});
