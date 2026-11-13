// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  cleanIntegrity,
  importedFailures,
  integrityFailures,
  type IntegritySnapshot,
} from '../../src/soak/integrity';

function withFault(patch: Partial<IntegritySnapshot>): IntegritySnapshot {
  return { ...cleanIntegrity(), ...patch };
}

describe('integrityFailures', () => {
  it('passes a clean snapshot', () => {
    expect(integrityFailures(cleanIntegrity())).toEqual([]);
  });

  it('names a changed file', () => {
    expect(integrityFailures(withFault({ assetMismatches: ['changed-file'] }))).toEqual([
      'asset-mismatch:changed-file',
    ]);
  });

  it('names a missing audit row', () => {
    expect(integrityFailures(withFault({ missingAudit: ['missing-audit-row'] }))).toEqual([
      'missing-audit:missing-audit-row',
    ]);
  });

  it('names a truncated render', () => {
    expect(integrityFailures(withFault({ invalidRenders: ['truncated-render'] }))).toEqual([
      'invalid-render:truncated-render',
    ]);
  });

  it('names leftover scratch', () => {
    expect(integrityFailures(withFault({ orphanScratch: ['leftover-scratch'] }))).toEqual([
      'orphan-scratch:leftover-scratch',
    ]);
  });

  it('names a sqlite integrity failure', () => {
    expect(integrityFailures(withFault({ sqlite: 'disk-image-malformed' }))).toEqual([
      'sqlite:disk-image-malformed',
    ]);
  });
});

describe('importedFailures', () => {
  const imported = [
    { id: 'a', sha256: '1'.repeat(64) },
    { id: 'b', sha256: '2'.repeat(64) },
  ];

  it('passes when every imported file is still an asset with its import hash', () => {
    expect(importedFailures(imported, [...imported, { id: 'c', sha256: '3'.repeat(64) }])).toEqual([]);
  });

  it('names a file whose bytes changed and one that is gone', () => {
    expect(importedFailures(imported, [{ id: 'a', sha256: '9'.repeat(64) }])).toEqual([
      'asset-changed:a',
      'asset-missing:b',
    ]);
  });
});
