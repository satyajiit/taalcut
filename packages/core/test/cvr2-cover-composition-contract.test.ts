// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// CVR2: a cover designed as a HyperFrames composition over real frames. The cover keeps the composition's files,
// its words (variables and their values), the pictures it draws by reference, the medium the model stated, and
// the designs it offers. Covers saved before CVR2 (a frame, a preset, a 16-layer design) read as they did.
import { describe, expect, it } from 'vitest';
import {
  COVER_DESIGNS_MAX,
  COVER_MEDIUMS,
  COVER_PICTURES_MAX,
  coverCompositionSchema,
  coverImageSchema,
  coverLeadSource,
  coverSettingsSchema,
  newId,
} from '@taalcut/core';

const composition = (
  hash = 'b',
  pictures: unknown[] = [{ name: 'hero', source: { kind: 'frame', frame: 12 } }],
) => ({
  entry: 'cover/index.html',
  files: [{ path: 'cover/index.html', sha256: 'a'.repeat(64), bytes: 2_400 }],
  hash: hash.repeat(64),
  variables: [{ type: 'text', name: 'headline', maxLength: 40, sample: 'North of nowhere' }],
  at: 1,
  pictures,
});

describe('the cover composition contract (CVR2)', () => {
  it('keeps a designed cover: its files, words, pictures by reference, medium and designs', () => {
    const assetId = newId<'Asset'>();
    const parsed = coverSettingsSchema.parse({
      aspect: '4:5',
      source: { kind: 'frame', frame: 12 },
      medium: 'footage',
      composition: {
        ...composition('b', [
          { name: 'hero', source: { kind: 'frame', frame: 12 } },
          { name: 'second', source: { kind: 'asset', assetId } },
        ]),
        params: { headline: 'Dusk' },
        idea: 'Two frames meet on one seam',
      },
      options: { set: 'run-1', designs: [composition('b'), composition('c')] },
    });
    expect(parsed.composition).toMatchObject({
      params: { headline: 'Dusk' },
      pictures: [
        { name: 'hero', source: { kind: 'frame', frame: 12 } },
        // A library shot's second defaults to its start.
        { name: 'second', source: { kind: 'asset', assetId, seconds: 0 } },
      ],
    });
    expect(parsed.medium).toBe('footage');
    expect(COVER_MEDIUMS).toEqual(['footage', 'generated', 'drawn']);
    expect([COVER_PICTURES_MAX, COVER_DESIGNS_MAX]).toEqual([4, 3]);
  });

  it('says what a composition cover leads with, for a reader that knows no compositions', () => {
    const assetId = newId<'Asset'>();
    expect(coverLeadSource([])).toEqual({ kind: 'solid' });
    expect(coverLeadSource([{ name: 'hero', source: { kind: 'frame', frame: 7 } }])).toEqual({
      kind: 'frame',
      frame: 7,
    });
    expect(coverLeadSource([{ name: 'hero', source: { kind: 'asset', assetId, seconds: 3 } }])).toEqual({
      kind: 'asset',
      assetId,
    });
    // A drawn cover has no picture: a solid source with a composition is a whole cover.
    expect(
      coverSettingsSchema.safeParse({
        aspect: '1:1',
        source: { kind: 'solid' },
        medium: 'drawn',
        composition: composition('b', []),
      }).success,
    ).toBe(true);
  });

  it('refuses a composition that is not one cover design', () => {
    const cover = { aspect: '9:16', source: { kind: 'frame', frame: 12 }, medium: 'footage' };
    const bad = (value: unknown) => !coverSettingsSchema.safeParse(value).success;
    // Its entry is one of its files; a picture is named once, in the composition's own alphabet.
    expect(coverCompositionSchema.safeParse({ ...composition(), entry: 'other/index.html' }).success).toBe(
      false,
    );
    const twice = [
      { name: 'hero', source: { kind: 'frame', frame: 1 } },
      { name: 'hero', source: { kind: 'frame', frame: 2 } },
    ];
    expect(coverCompositionSchema.safeParse(composition('b', twice)).success).toBe(false);
    expect(
      coverCompositionSchema.safeParse(
        composition('b', [{ name: 'Hero Shot', source: { kind: 'frame', frame: 1 } }]),
      ).success,
    ).toBe(false);
    const many = Array.from({ length: COVER_PICTURES_MAX + 1 }, (_, n) => ({
      name: `p${n}`,
      source: { kind: 'frame', frame: n },
    }));
    expect(coverCompositionSchema.safeParse(composition('b', many)).success).toBe(false);
    // Drawn by its composition or by an old design, never both; the design in use is one of those offered.
    const design = {
      version: 1,
      palette: { ink: '#111111', paper: '#eeeeee', accent: '#ed751b', muted: '#888888' },
      layers: [],
    };
    expect(bad({ ...cover, composition: composition(), design })).toBe(true);
    expect(
      bad({ ...cover, composition: composition('b'), options: { set: 'r', designs: [composition('c')] } }),
    ).toBe(true);
    expect(bad({ ...cover, options: { set: 'r', designs: [composition('c')] } })).toBe(true);
    expect(
      bad({
        ...cover,
        composition: composition('b'),
        options: { set: 'r', designs: ['b', 'c', 'd', 'e'].map((hash) => composition(hash)) },
      }),
    ).toBe(true);
    expect(bad({ ...cover, medium: 'photo' })).toBe(true);
  });

  it('reads covers saved before CVR2 as they were, with no medium and no composition', () => {
    const frame = coverSettingsSchema.parse({
      aspect: '9:16',
      source: { kind: 'frame', frame: 3 },
      hookText: 'Market morning',
    });
    expect(frame).not.toHaveProperty('composition');
    expect(frame).not.toHaveProperty('medium');
    expect(frame.hookText).toBe('Market morning');
    expect(coverSettingsSchema.safeParse({ aspect: '9:16', source: { kind: 'solid' } }).success).toBe(false);
  });

  it('carries a drawn composition cover’s checks beside its picture', () => {
    const image = {
      mimeType: 'image/jpeg',
      dataBase64: '/9j/2Q==',
      width: 1080,
      height: 1920,
      revision: 4,
    };
    expect(coverImageSchema.parse(image)).not.toHaveProperty('checks');
    expect(
      coverImageSchema.parse({ ...image, checks: [{ id: 'words', status: 'fail', detail: 'cut' }] }).checks,
    ).toEqual([{ id: 'words', status: 'fail', detail: 'cut' }]);
  });
});
