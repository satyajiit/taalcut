// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: QA summary line and checklist · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 (Status: an icon and a plain sentence; colour never alone)
 * states: summary: passed (success) · passed with warnings (warning, calm: the words say how many) · needs a look
 *   (danger) · exported anyway (neutral) · checklist rows: failed (danger icon + word, its fixes) · fixed ("Fixed: …",
 *   success) · warning (warning) · passed (success, details only) · skipped (ink-3) · fix buttons are Buttons (eight
 *   states, loading while a fix runs; an error stays on the caller's line) · Export anyway only when every failing
 *   check may be skipped
 * pre-emit critique: P5 H5 E4 S5 R5 V4 */
import type { MessageDescriptor } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import { Plural, useLingui } from '@lingui/react/macro';
import type { QaCheckId, QaFix, QaSummary } from '@taalcut/core';
import { CircleAlert, CircleCheck, CircleMinus, CircleX, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { qaTotals } from '../cards/export-labels';
import { qaCheckLabel, qaFixLabel } from './render-words';

type Verdict = QaSummary['verdict'];
type Status = 'pass' | 'warn' | 'fail' | 'fixed' | 'skipped';

const VERDICT: Readonly<Record<Verdict, { icon: LucideIcon; tone: string; word: MessageDescriptor }>> = {
  passed: { icon: CircleCheck, tone: 'text-success-strong', word: msg`Passed` },
  passedWithWarnings: { icon: CircleAlert, tone: 'text-warning-strong', word: msg`Passed with warnings` },
  needsAttention: { icon: CircleX, tone: 'text-danger-strong', word: msg`Needs review` },
  overridden: { icon: CircleMinus, tone: 'text-ink-2', word: msg`Exported anyway` },
};

/** "Checked: 18 of 19 passed", its verdict as an icon (named for screen readers) and what else to know. */
export function QaSummaryLine({ summary, className }: { summary: QaSummary; className?: string }) {
  const { t, i18n } = useLingui();
  const verdict = VERDICT[summary.verdict];
  // The same count every export card and render shows (gate criterion 4): what Taalcut fixed counts as passed.
  const totals = qaTotals(summary);
  const passed = i18n.number(totals.passed);
  const of = i18n.number(totals.total);
  return (
    <p
      data-slot="qa-summary"
      data-verdict={summary.verdict}
      className={cn('m-0 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink', className)}
    >
      <verdict.icon aria-hidden className={cn('size-4 shrink-0', verdict.tone)} />
      <span className="sr-only">{i18n._(verdict.word)}: </span>
      <span className="tabular-nums">{t`Checked: ${passed} of ${of} passed`}</span>
      {summary.failed > 0 ? (
        <span className="text-danger-strong tabular-nums">
          <Plural value={summary.failed} one="# needs you" other="# need you" />
        </span>
      ) : null}
      {summary.warned > 0 ? (
        <span className="text-ink-2 tabular-nums">
          <Plural value={summary.warned} one="# warning" other="# warnings" />
        </span>
      ) : null}
      {summary.fixed > 0 ? (
        <span className="text-ink-2 tabular-nums">
          <Plural value={summary.fixed} one="# fixed by Taalcut" other="# fixed by Taalcut" />
        </span>
      ) : null}
    </p>
  );
}

const STATUS: Readonly<Record<Status, { icon: LucideIcon; tone: string; word: MessageDescriptor }>> = {
  fail: {
    icon: CircleX,
    tone: 'text-danger-strong',
    word: msg({ message: 'Failed', context: 'a QA check' }),
  },
  fixed: {
    icon: CircleCheck,
    tone: 'text-success-strong',
    word: msg({ message: 'Fixed', context: 'a QA check' }),
  },
  warn: {
    icon: CircleAlert,
    tone: 'text-warning-strong',
    word: msg({ message: 'Warning', context: 'a QA check' }),
  },
  pass: {
    icon: CircleCheck,
    tone: 'text-success-strong',
    word: msg({ message: 'Passed', context: 'a QA check' }),
  },
  skipped: {
    icon: CircleMinus,
    tone: 'text-ink-3',
    word: msg({ message: 'Skipped', context: 'a QA check' }),
  },
};
const ORDER: readonly Status[] = ['fail', 'fixed', 'warn', 'pass', 'skipped'];

/** A check as the card carries it, or as the full report has it (with what was measured). */
export interface QaChecklistItem {
  readonly id: QaCheckId;
  readonly status: Status;
  readonly labelKey: string;
  readonly overridable: boolean;
  readonly fixes: readonly QaFix[];
  readonly measured?: { readonly value: number; readonly unit: string } | undefined;
}

function useMeasure() {
  const { t, i18n } = useLingui();
  const locale = i18n.locale === 'en-XA' ? 'en' : i18n.locale;
  return ({ value, unit }: { value: number; unit: string }): string => {
    const number = (style?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(locale, { maximumFractionDigits: 1, ...style }).format(value);
    switch (unit) {
      case 'ms':
        return number({ style: 'unit', unit: 'millisecond', unitDisplay: 'short' });
      case 'seconds':
        return number({ style: 'unit', unit: 'second', unitDisplay: 'short' });
      case 'kbps':
        return number({ style: 'unit', unit: 'kilobit-per-second', unitDisplay: 'short' });
      case 'frames':
        return t`${plural(value, { one: '# frame', other: '# frames' })}`;
      case 'lufs': {
        const n = number();
        return t`${n} LUFS`;
      }
      case 'dbtp': {
        const n = number();
        return t`${n} dBTP`;
      }
      case 'db': {
        const n = number();
        return t`${n} dB`;
      }
      case 'px': {
        const n = number({ maximumFractionDigits: 0 });
        return t`${n} px`;
      }
      default:
        return number({ maximumFractionDigits: 2 });
    }
  };
}

export interface QaChecklistProps {
  checks: readonly QaChecklistItem[];
  /** A fix button: a ready command, or one that needs the agent's judgment. */
  onFix?: (check: QaChecklistItem, fix: QaFix) => void | Promise<unknown>;
  /** "Export anyway" with the failing checks' ids. */
  onOverride?: (checks: readonly QaCheckId[]) => void | Promise<unknown>;
  /** Every check, passed ones too (View details). Folded: only what needs reading. */
  expanded?: boolean;
  /** Buttons off: the run ended or the render is gone. */
  disabled?: boolean;
  className?: string;
}

export function QaChecklist({
  checks,
  onFix,
  onOverride,
  expanded = false,
  disabled = false,
  className,
}: QaChecklistProps) {
  const { t, i18n } = useLingui();
  const measure = useMeasure();
  const [running, setRunning] = useState<string | null>(null);
  const rows = [...checks]
    .filter(
      (check) => expanded || check.status === 'fail' || check.status === 'warn' || check.status === 'fixed',
    )
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const failing = checks.filter((check) => check.status === 'fail');
  const canOverride = failing.length > 0 && failing.every((check) => check.overridable) && onOverride;

  const press = async (key: string, run: () => void | Promise<unknown>) => {
    setRunning(key);
    try {
      await run();
    } finally {
      setRunning(null);
    }
  };

  if (rows.length === 0 && !canOverride) return null;
  return (
    <div data-slot="qa-checklist" className={cn('flex flex-col gap-2', className)}>
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((check) => {
          const status = STATUS[check.status];
          const name = qaCheckLabel(i18n, check.labelKey);
          const fixes = check.status === 'fail' || check.status === 'warn' ? check.fixes.slice(0, 3) : [];
          return (
            <li
              key={check.id}
              data-check={check.id}
              data-status={check.status}
              className="flex flex-col gap-2 border-b border-rule-subtle py-2 last:border-b-0"
            >
              <div className="flex items-start gap-2 text-sm">
                <status.icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', status.tone)} />
                <span className="min-w-0 flex-1 text-ink">
                  {check.status === 'fixed' ? t`Fixed: ${name}` : name}
                </span>
                {check.measured ? (
                  <span className="shrink-0 text-xs text-ink-3 tabular-nums">{measure(check.measured)}</span>
                ) : null}
                <span className={cn('shrink-0 text-xs font-medium', status.tone)}>{i18n._(status.word)}</span>
              </div>
              {fixes.length > 0 && onFix ? (
                <div className="flex flex-wrap gap-2 ps-6">
                  {fixes.flatMap((fix, index) => {
                    if (fix.kind === 'auto') return [];
                    const key = `${check.id}:${index}`;
                    const words =
                      fix.kind === 'command'
                        ? qaFixLabel(i18n, fix.labelKey)
                        : qaFixLabel(i18n, fix.instructionKey, fix.params);
                    return [
                      <Button
                        key={key}
                        size="sm"
                        variant="secondary"
                        disabled={disabled}
                        loading={running === key}
                        onClick={() => void press(key, () => onFix(check, fix))}
                      >
                        {words}
                      </Button>,
                    ];
                  })}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {canOverride ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            loading={running === 'override'}
            onClick={() => void press('override', () => onOverride(failing.map((check) => check.id)))}
          >
            {t`Export anyway`}
          </Button>
          <span className="text-xs text-ink-3">{t`Taalcut keeps a note that you chose this.`}</span>
        </div>
      ) : null}
    </div>
  );
}
