// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: Kaatu moment (UX4) · system: DESIGN.md "Mascot", UX4 companion
 * Kaatu with one line beside it, for the moments people remember: a wait over 2 s, something that finished, something
 *   that failed, and a page's first-visit tip. Unboxed: Kaatu's drawing on the column's edge, the line in ink-2, an
 *   action and a dismiss after it when there are any.
 * states: wait (thinking; the line is a polite status) · success (a grin, then idle) · failure (a bashful look, then
 *   idle; the line is an alert) · tip (idle; dismissable) · Kaatu hidden (Show Kaatu off, or the page already shows
 *   one): the line alone. Not a control itself; its dismiss is a ghost icon button with the kit's eight states.
 * motion: Kaatu's own; nothing else moves. Reduced motion: Kaatu's reduced path.
 * guardrails: never over footage, in a decision card or the composer; at most one moment and the companion on a
 *   screen; Kaatu is decorative, the line carries the meaning. */
import { useLingui } from '@lingui/react/macro';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { Kaatu, type MascotMood } from './mascot';
import { HAPPY_MS, useIdleMood } from './use-mascot-mood';

export type KaatuMomentTone = 'wait' | 'success' | 'failure' | 'tip';

export interface KaatuMomentProps {
  tone: KaatuMomentTone;
  /** The one line: what is happening, what finished, what went wrong and its fix, or the tip. */
  children: ReactNode;
  /** One action after the line (a fix, "Open it"). */
  action?: ReactNode;
  /** A dismiss after the line (a tip's, remembered by the app). */
  onDismiss?: () => void;
  /** Its name; "Dismiss tip" for a tip, "Dismiss" otherwise. */
  dismissLabel?: string;
  /** Off where the page already shows Kaatu: one Kaatu on a screen besides the companion, so the moment speaks alone. */
  kaatu?: boolean;
  className?: string;
}

function useMomentMood(tone: KaatuMomentTone): MascotMood {
  const opening = tone === 'success' ? 'happy' : tone === 'failure' ? 'oops' : undefined;
  const idle = useIdleMood({
    ...(opening ? { startWith: opening } : {}),
    ...(tone === 'success' ? { startMs: HAPPY_MS } : {}),
  });
  return tone === 'wait' ? 'thinking' : idle;
}

/** Kaatu with a one-line helper beside it (DESIGN.md "Mascot", UX4). */
export function KaatuMoment({
  tone,
  children,
  action,
  onDismiss,
  dismissLabel,
  kaatu = true,
  className,
}: KaatuMomentProps) {
  const { t } = useLingui();
  const mood = useMomentMood(tone);
  const role = tone === 'failure' ? 'alert' : tone === 'tip' ? undefined : 'status';
  return (
    <div
      data-slot="kaatu-moment"
      data-tone={tone}
      className={cn('flex min-w-0 items-center gap-3', className)}
    >
      {kaatu ? <Kaatu spot="moment" mood={mood} /> : null}
      <p {...(role ? { role } : {})} className="m-0 min-w-0 type-body text-pretty text-ink-2">
        {children}
      </p>
      {action}
      {onDismiss ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-ink-3 hover:text-ink"
          aria-label={dismissLabel ?? (tone === 'tip' ? t`Dismiss tip` : t`Dismiss`)}
          onClick={onDismiss}
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
