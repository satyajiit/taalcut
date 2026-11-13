// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the connect steps as beats · genre: atmospheric studio app · system: DESIGN.md v0.3
 * first run's rail of beats, numbered because people read them aloud: this step a marigold ring, done ones a quiet
 *   check on the sunken well, those to come hollow; a hairline joins them. The PIN set large in JetBrains Mono (it
 *   changes in place when a new code is made), in two groups of three, as people read codes aloud.
 * states: current (aria-current="step") · done ("Done" for screen readers) · next; static, no motion
 */
import { useLingui } from '@lingui/react/macro';
import { cn } from '@taalcut/ui';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import type { StepState } from '../session/connection';

/** `size`: 'md' where the PIN is the fallback beside a QR (UX3), not the step itself. */
export function PinDisplay({ pin, size = 'lg' }: { pin: string; size?: 'lg' | 'md' }) {
  const { t } = useLingui();
  const spoken = pin.split('').join(' ');
  return (
    <p
      data-slot="pin"
      className={cn(
        'm-0 flex font-mono leading-none font-medium text-ink tabular-nums',
        size === 'lg' ? 'text-[2.5rem]' : 'text-[1.75rem]',
      )}
    >
      <span aria-hidden translate="no" className="flex gap-4">
        <span className="tracking-[0.12em]">{pin.slice(0, 3)}</span>
        <span className="tracking-[0.12em]">{pin.slice(3)}</span>
      </span>
      {/* Read digit by digit, as it is typed. */}
      <span className="sr-only">{t`PIN ${spoken}`}</span>
    </p>
  );
}

function Beat({ n, state }: { n: number; state: StepState }) {
  const { i18n } = useLingui();
  return (
    <span
      aria-hidden
      className={cn(
        'relative flex size-7 shrink-0 items-center justify-center rounded-pill type-label tabular-nums',
        state === 'current' && 'border-2 border-primary-strong bg-canvas text-ink',
        state === 'done' && 'border border-rule bg-chip text-ink-2',
        state === 'next' && 'border border-rule-strong bg-canvas text-ink-3',
      )}
    >
      {state === 'done' ? <Check className="size-3.5" strokeWidth={2.5} /> : i18n.number(n)}
    </span>
  );
}

export function Step({
  n,
  state,
  last = false,
  title,
  children,
}: {
  n: number;
  state: StepState;
  last?: boolean;
  title: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useLingui();
  return (
    <li
      aria-current={state === 'current' ? 'step' : undefined}
      data-step={state}
      className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3.5"
    >
      {last ? null : <span aria-hidden className="absolute top-8 -bottom-5 left-3.5 w-px bg-rule-subtle" />}
      <Beat n={n} state={state} />
      <div className="flex min-w-0 flex-col gap-2 pt-0.5">
        <p className={cn('m-0 type-card-title', state === 'done' ? 'text-ink-2' : 'text-ink')}>
          {state === 'done' ? <span className="sr-only">{t`Done:`} </span> : null}
          {title}
        </p>
        {children}
      </div>
    </li>
  );
}
