// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { disabledSecurityFeatures, featureNames } from '../src/main/security/security-features';

describe('featureNames', () => {
  it('reads plain names and the field-trial forms', () => {
    expect(featureNames('A, *B,C<Trial,D<Trial.Group:p/v,E:p/v, ,')).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});

describe('disabledSecurityFeatures (SB-7)', () => {
  it('names the security features in a value, ignoring case and trial suffixes', () => {
    expect(disabledSecurityFeatures('Translate,isolateorigins,SitePerProcess<Trial,MediaRouter')).toEqual([
      'isolateorigins',
      'SitePerProcess',
    ]);
  });

  it('finds none in a support workaround', () => {
    expect(disabledSecurityFeatures('Translate,MediaRouter,HardwareMediaKeyHandling')).toEqual([]);
    expect(disabledSecurityFeatures('')).toEqual([]);
  });
});
