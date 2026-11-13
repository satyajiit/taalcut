// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// EAR1-I5: the listening tools round EAR1 added have plain names in a tool row, never "A step".
import { i18n } from '@lingui/core';
import { describe, expect, it } from 'vitest';
import { toolLabel } from '../src/index';

describe('the listening tools’ names (EAR1)', () => {
  it('names each one', () => {
    expect(
      [
        'audio.listen',
        'audio.findMoment',
        'audio.compare',
        'audio.critique',
        'audio.cloudCritique',
        'sfx.searchSounds',
      ].map((tool) => toolLabel(i18n, tool)),
    ).toEqual([
      'Listen to the sound',
      'Find a sound in a recording',
      'Compare two sounds',
      'Check the sound mix',
      'Get a cloud opinion on the sound',
      'Search for sound effects',
    ]);
  });
});
