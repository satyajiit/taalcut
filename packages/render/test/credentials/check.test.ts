// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { aiInventory, type AiInventory } from '../../src/credentials/ai-inventory';
import { DIGITAL_SOURCE_TYPES } from '../../src/credentials/manifest';
import type { C2paReadSummary } from '../../src/credentials/sidecar';
import { contentCredentialsCheck, credentialProblems } from '../../src/qa/checks/credentials';
import { partsTimeline, type PartsSpec } from './support';

const inventoryOf = (spec: PartsSpec): AiInventory => {
  const { timeline, provenanceOf } = partsTimeline(spec);
  return aiInventory(timeline, provenanceOf);
};

const read = (overrides: Partial<C2paReadSummary> = {}): C2paReadSummary => ({
  state: 'valid',
  generator: 'Taalcut 0.1.0',
  issuer: 'C2PA Test Signing Cert',
  digitalSourceTypes: [DIGITAL_SOURCE_TYPES.compositeCapture],
  actions: ['c2pa.created'],
  actionsV2: true,
  ingredients: 0,
  ingredientDetails: [],
  failures: ['signingCredential.untrusted'],
  ...overrides,
});

const captured = inventoryOf({ clips: [false, false] });
const mixed = inventoryOf({ clips: [false, true] });

describe('contentCredentials', () => {
  it('passes a test-signed export whose only failure is the untrusted issuer', () => {
    const result = contentCredentialsCheck({
      add: true,
      boxPresent: true,
      read: read(),
      inventory: captured,
    });
    expect(result).toMatchObject({ id: 'contentCredentials', status: 'pass', overridable: false, fixes: [] });
  });

  it('fails a requested manifest that is missing, unreadable or invalid, with the remux fix', () => {
    expect(credentialProblems({ add: true, boxPresent: false, read: read(), inventory: captured })).toEqual([
      'missing',
    ]);
    expect(credentialProblems({ add: true, boxPresent: true, read: null, inventory: captured })).toEqual([
      'missing',
    ]);
    expect(
      credentialProblems({
        add: true,
        boxPresent: true,
        read: read({ state: 'absent' }),
        inventory: captured,
      }),
    ).toEqual(['missing']);
    const invalid = contentCredentialsCheck({
      add: true,
      boxPresent: true,
      read: read({ state: 'invalid', failures: ['assertion.bmffHash.mismatch'] }),
      inventory: captured,
    });
    expect(invalid).toMatchObject({ status: 'fail', fixes: [{ kind: 'auto', action: 'remux' }] });
    expect(invalid.findings.map((finding) => finding.target?.id)).toEqual(['invalid']);
    expect(
      credentialProblems({
        add: true,
        boxPresent: true,
        read: read({ failures: ['signingCredential.untrusted', 'claimSignature.mismatch'] }),
        inventory: captured,
      }),
    ).toEqual(['invalid']);
  });

  it('wants c2pa.actions.v2', () => {
    expect(
      credentialProblems({
        add: true,
        boxPresent: true,
        read: read({ actionsV2: false }),
        inventory: captured,
      }),
    ).toEqual(['actionsNotV2']);
  });

  it('fails an AI claim the inventory does not back, and generated parts the manifest hides', () => {
    const aiOnCaptured = read({ digitalSourceTypes: [DIGITAL_SOURCE_TYPES.compositeSynthetic] });
    expect(
      credentialProblems({ add: true, boxPresent: true, read: aiOnCaptured, inventory: captured }),
    ).toEqual(['aiUnsupported']);
    const wholeAi = read({ digitalSourceTypes: [DIGITAL_SOURCE_TYPES.trainedAlgorithmicMedia] });
    expect(credentialProblems({ add: true, boxPresent: true, read: wholeAi, inventory: mixed })).toEqual([
      'aiUnsupported',
    ]);
    expect(credentialProblems({ add: true, boxPresent: true, read: read(), inventory: mixed })).toEqual([
      'aiUndeclared',
    ]);
    const honest = read({
      digitalSourceTypes: [
        DIGITAL_SOURCE_TYPES.compositeSynthetic,
        DIGITAL_SOURCE_TYPES.compositeWithTrainedAlgorithmicMedia,
      ],
    });
    expect(credentialProblems({ add: true, boxPresent: true, read: honest, inventory: mixed })).toEqual([]);
  });

  it('with the toggle off, fails any manifest box and passes a clean file', () => {
    expect(
      contentCredentialsCheck({ add: false, boxPresent: true, read: null, inventory: mixed }),
    ).toMatchObject({
      status: 'fail',
      findings: [{ target: { kind: 'file', id: 'addedWhileOff' } }],
    });
    expect(
      contentCredentialsCheck({ add: false, boxPresent: false, read: null, inventory: mixed }).status,
    ).toBe('pass');
  });
});
