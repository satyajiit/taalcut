// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H5 E4 S5 R5 V4
 * Hallmark · component: share refused (U3) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · why the hub said no, in one line with its one way forward: Local only with Open Privacy
 *   (the usual line), a rate limit with when to try again, anything else as the error line with its fix
 * states: refused · fixing (the fix spins) · fixed (the error line says so) · n/a: hover/focus/active/disabled are
 *   the fix Button's
 */
import { useLingui } from '@lingui/react/macro';
import type { FixAction, TaalcutError } from '@taalcut/core';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/button';
import { ErrorLine } from '../cards/error-line';
import type { FixOutcome } from '../feedback/error-card';
import { retryIn } from './hub-words';

export interface ShareRefusedProps {
  readonly error: TaalcutError;
  readonly onFix?: ((fix: FixAction) => FixOutcome | Promise<FixOutcome>) | undefined;
}

export function ShareRefused({ error, onFix }: ShareRefusedProps) {
  const { t, i18n } = useLingui();
  const [fixing, setFixing] = useState(false);
  if (error.code === 'core.local_only') {
    const fix = error.fix;
    return (
      <div
        role="alert"
        data-slot="share-refused"
        data-error-code={error.code}
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-rule bg-panel px-3 py-2"
      >
        <p className="m-0 flex items-center gap-2 text-sm text-ink">
          <ShieldCheck aria-hidden className="size-4 shrink-0 text-ink-2" />
          {t`Sharing is off while Local only is on. Nothing leaves this Mac.`}
        </p>
        {fix && onFix ? (
          <Button
            size="sm"
            loading={fixing}
            onClick={async () => {
              setFixing(true);
              await onFix(fix);
              setFixing(false);
            }}
          >
            {t`Open Privacy`}
          </Button>
        ) : null}
      </div>
    );
  }
  const seconds = error.code === 'hub.rate_limited' ? error.params?.['retryAfterSeconds'] : undefined;
  const when = typeof seconds === 'number' && seconds > 0 ? retryIn(i18n, seconds) : null;
  return (
    <div data-slot="share-refused" data-error-code={error.code} className="flex flex-col gap-1.5">
      <ErrorLine key={error.code} error={error} {...(onFix ? { onFix } : {})} />
      {when ? <p className="m-0 text-sm text-ink-2">{t`You can try again ${when}.`}</p> : null}
    </div>
  );
}
