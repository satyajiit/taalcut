// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: forget what phones remember · genre: atmospheric studio app · system: DESIGN.md v0.3
 * a hairline row: what is remembered and why, then a secondary Button that says what it forgets; done, the row
 *   says what happened in one quiet line (success is silent otherwise: no toast)
 * states: default · hover · focus · active (Button) · disabled: n/a · loading (the Button spins) · error (the cause
 *   under the row, Try again) · success (one line with the success check, announced)
 */
import type { Result } from '@taalcut/core';
import { Button, ErrorLine } from '@taalcut/ui';
import { CircleCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';

export function ForgetRow<T>({
  title,
  description,
  action,
  run,
  done,
}: {
  title: ReactNode;
  description: ReactNode;
  /** The Button's words: what it forgets. */
  action: ReactNode;
  run: () => Promise<Result<T>>;
  /** What happened, from the answer. */
  done: (value: T) => ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result<T> | null>(null);
  const forget = async () => {
    setBusy(true);
    setResult(null);
    setResult(await run());
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-2 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex max-w-prose min-w-0 flex-col gap-1">
          <p className="m-0 type-card-title text-ink">{title}</p>
          <p className="m-0 type-body text-ink-2">{description}</p>
        </div>
        <Button variant="secondary" size="sm" loading={busy} onClick={() => void forget()}>
          {action}
        </Button>
      </div>
      <div role="status">
        {result?.ok ? (
          <p className="m-0 flex items-center gap-2 type-body text-ink-2">
            <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" />
            {done(result.value)}
          </p>
        ) : null}
      </div>
      {result && !result.ok ? <ErrorLine error={result.error} onRetry={() => void forget()} /> : null}
    </div>
  );
}
