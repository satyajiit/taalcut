// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { StockLicenceRefused } from '../../src/errors';
import { attributionLine, classifyLicence, LICENCE_TABLE, pexelsCourtesy } from '../../src/stock/licences';

const REFUSED = [
  ['pexels', 'CC0-1.0'],
  ['pexels', 'CC-BY-4.0'],
  ['freesound', 'Attribution NonCommercial'],
  ['freesound', 'Attribution NonCommercial ShareAlike'],
  ['freesound', 'Attribution ShareAlike'],
  ['freesound', 'Attribution NoDerivatives'],
  ['freesound', 'Sampling+'],
  ['freesound', 'Creative Commons Sampling Plus'],
  ['freesound', ''],
  ['freesound', 'Pexels-Licence'],
] as const;

describe('stock licences', () => {
  it.each(LICENCE_TABLE)('maps $provider $raw to $licence', (row) => {
    const classified = classifyLicence(row.provider, row.raw);
    expect(classified.ok && classified.value).toBe(row.licence);
  });

  it.each(REFUSED)('refuses %s %j', (provider, raw) => {
    const classified = classifyLicence(provider, raw);
    expect(classified.ok).toBe(false);
    if (classified.ok) return;
    expect(StockLicenceRefused.is(classified.error)).toBe(true);
    expect(classified.error.retryable).toBe(false);
    expect(classified.error.params).toEqual({ licence: raw });
  });

  it('writes a CC-BY line and nothing for CC0 or Pexels', () => {
    expect(attributionLine('CC-BY-4.0', { title: 'Bell', author: 'ben', id: '2' })).toBe(
      '"Bell" by ben (https://freesound.org/s/2/) licensed under CC BY 4.0',
    );
    expect(attributionLine('CC0-1.0', { title: 'Rain', author: 'ada', id: '1' })).toBe('');
    expect(attributionLine('Pexels-Licence', { title: 'Ocean', author: 'Ada', id: '101' })).toBe('');
    expect(pexelsCourtesy('Ada')).toBe('Video by Ada on Pexels');
  });
});
