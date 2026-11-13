// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: design checks (HFW1-UI) · genre: atmospheric studio app (the editor's dock)
 * system: DESIGN.md v0.3 · the checks a design passed before it went on the timeline: one line that sums them up,
 *   then each check in the editor's words with its status as a word and a glyph (passed, fixed, didn't pass, not
 *   checked) and, under it, the check's own note as written (the gate's words for the model: data, shown quietly).
 *   A static list: nothing to press, no tab stops
 * states: all passed · some fixed · one that didn't pass (a design on the timeline always passed; an older copy
 *   may say otherwise) · pre-emit critique: P5 H4 E4 S4 R5 V4 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { CompositionGate, CompositionGateCheck } from '@taalcut/core';
import { cn, UserContent } from '@taalcut/ui';
import { Circle, CircleCheck, CircleX, Wrench } from 'lucide-react';
import { CHECK_STATUS_WORDS, CHECK_WORDS, OTHER_CHECK } from './check-words';

const STATUS_LOOK: Readonly<Record<CompositionGateCheck['status'], { icon: typeof Circle; ink: string }>> = {
  pass: { icon: CircleCheck, ink: 'text-success-strong' },
  repaired: { icon: Wrench, ink: 'text-warning-strong' },
  fail: { icon: CircleX, ink: 'text-danger-strong' },
  skipped: { icon: Circle, ink: 'text-ink-3' },
};

export function DesignChecks({ gate }: { gate: CompositionGate }) {
  const { t, i18n } = useLingui();
  const fixed = gate.checks.filter((check) => check.status === 'repaired').length;
  const failed = gate.checks.some((check) => check.status === 'fail') || !gate.passed;
  const summary = failed
    ? t`It didn’t pass every check.`
    : fixed > 0
      ? t`It passed every check; ${plural(fixed, { one: 'one needed a fix', other: '# needed a fix' })}.`
      : t`It passed every check.`;
  return (
    <div data-slot="design-checks" className="flex flex-col gap-2">
      <p className="m-0 type-body text-ink">{summary}</p>
      <ul aria-label={t`Checks`} className="m-0 flex list-none flex-col gap-1.5 p-0">
        {gate.checks.map((check) => {
          const look = STATUS_LOOK[check.status];
          const Icon = look.icon;
          const words = CHECK_WORDS[check.id];
          return (
            <li key={check.id} data-check={check.id} data-status={check.status} className="flex gap-2">
              <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', look.ink)} />
              <div className="flex min-w-0 flex-col">
                <p className="m-0 type-body text-ink">
                  {words ? i18n._(words) : i18n._(OTHER_CHECK)}
                  <span className="sr-only">: </span>
                  <span className={cn('ms-2 type-meta', look.ink)}>
                    {i18n._(CHECK_STATUS_WORDS[check.status])}
                  </span>
                </p>
                {check.detail ? (
                  <UserContent translate="no" className="type-meta text-ink-2 [overflow-wrap:anywhere]">
                    {check.detail}
                  </UserContent>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
