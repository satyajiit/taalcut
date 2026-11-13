// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The gate's report (core `CompositionGate`): each finding's code names the check it belongs to, and a check is
 * `fail` when one of its errors is there, `skipped` when a check before it failed so it could not run (the files'
 * limits before everything; the document before its style, script and assets), else `pass`. A failed check's
 * detail is its first finding and what to do about it.
 */
import type { CompositionGate, CompositionGateCheck } from '@taalcut/core';
import type { WorkspaceFinding } from './finding';

/** The gate's checks, in the order they run. */
export const GATE_CHECKS = ['limits', 'hfLint', 'markup', 'css', 'lowering', 'urls'] as const;
export type GateCheckId = (typeof GATE_CHECKS)[number];

const LIMIT_CODES = new Set([
  'gate.files',
  'gate.size',
  'gate.path',
  'gate.entry',
  'gate.duration',
  'lower.limit',
]);
/** The files' limits (workspace-gate.ts). */
const FILE_CODES = new Set(['gate.files', 'gate.size', 'gate.path', 'gate.entry']);
/** Limit codes the document's reading gives (document.ts): when one is there, nothing after the document ran. */
const DOCUMENT_CODES = new Set(['gate.duration']);

/** The check a finding's code belongs to. */
export function checkOf(code: string): GateCheckId {
  if (code.startsWith('hf.')) return 'hfLint';
  if (LIMIT_CODES.has(code)) return 'limits';
  if (code.startsWith('lower.')) return 'lowering';
  if (code === 'gate.css') return 'css';
  if (code === 'gate.asset') return 'urls';
  return 'markup';
}

const isError = (finding: WorkspaceFinding) => finding.severity === 'error';

function detailOf(findings: readonly WorkspaceFinding[]): string | undefined {
  const [first] = findings;
  if (!first) return undefined;
  const more = findings.length > 1 ? ` (+${findings.length - 1} more)` : '';
  const text = `${first.message}. ${first.fixHint}${more}`;
  return text.length > 500 ? `${text.slice(0, 499)}…` : text;
}

export interface GateReportInput {
  readonly version: string;
  readonly checkedAt: number;
  /** Every finding of the run (errors and warnings). */
  readonly findings: readonly WorkspaceFinding[];
  readonly loweredTweens?: number;
  /** Whether the assets it loads were checked (only once its style and script passed). */
  readonly urlsChecked?: boolean;
}

export function gateReport(input: GateReportInput): CompositionGate {
  const errors = input.findings.filter(isError);
  const failing = new Set(errors.map((finding) => checkOf(finding.code)));
  const documentFailed = failing.has('markup') || errors.some((finding) => DOCUMENT_CODES.has(finding.code));
  // The files' own limits run first: when they fail, the gate reads nothing of them.
  const filesFailed = errors.some((finding) => FILE_CODES.has(finding.code));
  const ran = (check: GateCheckId): boolean => {
    if (check === 'limits') return true;
    if (filesFailed) return false;
    if (check === 'hfLint' || check === 'markup') return true;
    if (documentFailed) return false;
    return check !== 'urls' || input.urlsChecked === true;
  };
  const checks: CompositionGateCheck[] = GATE_CHECKS.map((id) => {
    const own = errors.filter((finding) => checkOf(finding.code) === id);
    const detail = detailOf(own);
    const status = own.length > 0 ? 'fail' : ran(id) ? 'pass' : 'skipped';
    return { id, status, ...(detail ? { detail } : {}) };
  });
  const lint = input.findings.filter((finding) => finding.code.startsWith('hf.'));
  return {
    version: input.version,
    passed: checks.every((check) => check.status === 'pass'),
    checkedAt: input.checkedAt,
    hfLint: { errors: lint.filter(isError).length, warnings: lint.filter((f) => !isError(f)).length },
    checks,
    loweredTweens: Math.min(input.loweredTweens ?? 0, 300),
  };
}
