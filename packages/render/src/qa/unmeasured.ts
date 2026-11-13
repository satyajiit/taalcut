// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** QA that can't see the file can't approve it: an unmeasured check fails (docs/qa-gate.md, rule 6). */
import type { QaCheckId, QaCheckResult } from '@taalcut/core';
import { autoFix, checkResult } from './result';

/** A check whose measurement failed: it fails, and a fresh render is the fix. */
export function unmeasured(id: QaCheckId, reason: string): QaCheckResult {
  return checkResult(
    id,
    'fail',
    { findings: [{ target: { kind: 'file', id: reason.slice(0, 64) } }], fixes: [autoFix('rerender')] },
    0,
  );
}
