// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * contentCredentials (SPEC P3.10, docs/qa-gate.md). Toggle on: the delivered file carries a manifest that
 * validates (with the test certificate the only failure allowed is `signingCredential.untrusted`), states its
 * actions as `c2pa.actions.v2`, and says AI exactly when the inventory has generated parts: an AI term without
 * one is a false claim, and no AI term with one hides it. Toggle off: no manifest box at all, because Taalcut
 * adds nothing unless the person asked. Not overridable; the fix is a remux, after which signing runs again.
 */
import type { QaCheckResult } from '@taalcut/core';
import type { AiInventory } from '../../credentials/ai-inventory';
import { TOLERATED_FAILURES } from '../../credentials/content-credentials';
import { AI_DIGITAL_SOURCE_TYPES, DIGITAL_SOURCE_TYPES } from '../../credentials/manifest';
import type { C2paReadSummary } from '../../credentials/sidecar';
import { autoFix, checkResult, type QaFinding } from '../result';

export const CREDENTIAL_PROBLEMS = [
  /** On, but the file has no manifest (or the sidecar couldn't read it). */
  'missing',
  /** The signature or a hash doesn't validate. */
  'invalid',
  /** No `c2pa.actions.v2` assertion. */
  'actionsNotV2',
  /** An AI digital source type the inventory doesn't support. */
  'aiUnsupported',
  /** Generated parts, but the manifest says nothing about AI. */
  'aiUndeclared',
  /** Off, but a manifest box is in the file. */
  'addedWhileOff',
] as const;
export type CredentialProblem = (typeof CREDENTIAL_PROBLEMS)[number];

export interface CredentialsCheckInput {
  /** The export's option. */
  readonly add: boolean;
  /** A C2PA manifest box in the delivered file's bytes (hasC2paManifestBox). */
  readonly boxPresent: boolean;
  /** The sidecar's read of the delivered file (on only); null when it couldn't be read. */
  readonly read: C2paReadSummary | null;
  readonly inventory: AiInventory;
}

/** What is wrong with the delivered file's credentials, in a stable order. */
export function credentialProblems(input: CredentialsCheckInput): CredentialProblem[] {
  if (!input.add) return input.boxPresent ? ['addedWhileOff'] : [];
  const read = input.read;
  if (!input.boxPresent || !read || read.state === 'absent') return ['missing'];
  const problems: CredentialProblem[] = [];
  const signed = read.state === 'valid' || read.state === 'trusted';
  if (!signed || read.failures.some((code) => !TOLERATED_FAILURES.has(code))) problems.push('invalid');
  if (!read.actionsV2) problems.push('actionsNotV2');
  const aiTerms = read.digitalSourceTypes.filter((type) => AI_DIGITAL_SOURCE_TYPES.has(type));
  const generated = input.inventory.generated.length > 0;
  const wholeAi = read.digitalSourceTypes.includes(DIGITAL_SOURCE_TYPES.trainedAlgorithmicMedia);
  if ((aiTerms.length > 0 && !generated) || (wholeAi && !input.inventory.allGenerated))
    problems.push('aiUnsupported');
  if (generated && aiTerms.length === 0) problems.push('aiUndeclared');
  return problems;
}

export function contentCredentialsCheck(input: CredentialsCheckInput, durationMs = 0): QaCheckResult {
  const problems = credentialProblems(input);
  const findings: QaFinding[] = problems.map((problem) => ({ target: { kind: 'file', id: problem } }));
  return checkResult(
    'contentCredentials',
    problems.length === 0 ? 'pass' : 'fail',
    { findings, measured: { value: problems.length, unit: 'count' }, fixes: [autoFix('remux')] },
    durationMs,
  );
}
