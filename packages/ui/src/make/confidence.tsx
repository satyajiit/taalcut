// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: confidence · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * how sure the AI is about a pick, as a word and a three-step meter in neutral ink (never a status colour: a low
 *   pick is not an error); "Checked again" when a vision model looked at it a second time
 * states: high · medium · low · not scored (no pick) · checked again · not interactive
 * pre-emit critique: P5 H4 E5 S5 R5 V4 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { RefreshCw } from 'lucide-react';
import { cn } from '#lib/cn';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** ≥ 0.75 high, ≥ 0.5 medium, below that low. */
export function confidenceLevel(value: number): ConfidenceLevel {
  return value >= 0.75 ? 'high' : value >= 0.5 ? 'medium' : 'low';
}

const WORDS: Readonly<Record<ConfidenceLevel, MessageDescriptor>> = {
  high: msg({ message: 'High', context: 'how sure the AI is about a pick' }),
  medium: msg({ message: 'Medium', context: 'how sure the AI is about a pick' }),
  low: msg({ message: 'Low', context: 'how sure the AI is about a pick' }),
};
const STEPS: Readonly<Record<ConfidenceLevel, number>> = { high: 3, medium: 2, low: 1 };

export interface ConfidenceProps {
  /** 0 to 1; null when there is nothing to score (an empty slot). */
  value: number | null;
  reranked?: boolean;
  className?: string;
}

export function Confidence({ value, reranked = false, className }: ConfidenceProps) {
  const { t, i18n } = useLingui();
  if (value === null) return null;
  const level = confidenceLevel(value);
  const word = i18n._(WORDS[level]);
  return (
    <span
      data-slot="confidence"
      data-level={level}
      className={cn('inline-flex flex-col items-start gap-0.5 text-xs text-ink-2', className)}
    >
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-flex items-end gap-px">
          {[1, 2, 3].map((step) => (
            <span
              key={step}
              className={cn(
                'block w-1 rounded-[1px]',
                step === 1 ? 'h-1.5' : step === 2 ? 'h-2' : 'h-2.5',
                step <= STEPS[level] ? 'bg-ink-2' : 'bg-rule',
              )}
            />
          ))}
        </span>
        <span>
          <span className="sr-only">{t`Confidence:`} </span>
          {word}
        </span>
      </span>
      {reranked ? (
        <span className="inline-flex items-center gap-1 text-2xs text-ink-3">
          <RefreshCw aria-hidden className="size-2.5" />
          {t`Checked again`}
        </span>
      ) : null}
    </span>
  );
}
