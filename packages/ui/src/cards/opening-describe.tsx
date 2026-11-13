// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: opening choice, just describe it (no composer) · genre: atmospheric studio app
 * system: DESIGN.md v0.3 · where there is no composer to put the caret in (first run), the description is written
 *   under the choice: a text box and Start
 * states: default · hover · focus (base ring) · disabled (busy) · loading (Start spins) · error (empty: the line
 *   under it, aria-invalid) · success (the chat takes over) */

import { Trans, useLingui } from '@lingui/react/macro';
import type { TaalcutError } from '@taalcut/core';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { ErrorLine } from './error-line';

export interface OpeningDescribeProps {
  disabled: boolean;
  onStart: (text: string) => Promise<TaalcutError | null>;
}

/** Say what you want, in your own words: it becomes the chat's first message. */
export function OpeningDescribe({ disabled, onStart }: OpeningDescribeProps) {
  const { t } = useLingui();
  const field = useId();
  const help = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<TaalcutError | null>(null);
  useEffect(() => box.current?.focus(), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const words = text.trim();
    if (!words) return setEmpty(true);
    setBusy(true);
    setFailed(null);
    const error = await onStart(words);
    setBusy(false);
    if (error) setFailed(error);
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-1.5 p-3">
      <label htmlFor={field} className="text-sm font-medium text-ink">
        <Trans>The video you want</Trans>
      </label>
      <textarea
        ref={box}
        id={field}
        rows={3}
        value={text}
        disabled={disabled}
        aria-invalid={empty || undefined}
        aria-describedby={help}
        placeholder={t`A 30 second reel of my Goa trip, upbeat, the sunset last`}
        onChange={(event) => {
          setText(event.target.value);
          if (empty) setEmpty(false);
        }}
        className={cn(
          'w-full resize-y rounded-md border border-rule-strong bg-canvas px-3 py-2 text-base text-ink',
          'placeholder:text-ink-3 hover:border-ink-3 aria-invalid:border-danger-strong',
          'disabled:cursor-not-allowed disabled:border-rule-subtle disabled:bg-sunken disabled:text-ink-disabled',
        )}
      />
      <p
        id={help}
        role={empty ? 'alert' : undefined}
        className={cn('m-0 text-sm', empty ? 'text-danger-strong' : 'text-ink-2')}
      >
        {empty ? t`Say a few words about it first.` : t`What it’s about, how long, and the feel.`}
      </p>
      <Button type="submit" variant="primary" className="self-start" loading={busy} disabled={disabled}>
        <Trans>Start</Trans>
      </Button>
      {failed ? <ErrorLine error={failed} /> : null}
    </form>
  );
}
