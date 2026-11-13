// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: copy to the clipboard · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * a ghost Button whose own label is the feedback: "Copied" with a check for 2.5 s, then back; no toast
 * states: default · hover · focus (base ring) · active (Button) · disabled (nothing to copy yet) · loading: n/a (the
 *   clipboard answers at once) · error ("Couldn’t copy", the Button's error status, until the next try) · success
 *   ("Copied", the success status; announced politely)
 */
import { useLingui } from '@lingui/react/macro';
import { Button } from '@taalcut/ui';
import { Check, CircleAlert, Copy } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

const COPIED_MS = 2_500;

type CopyState = 'idle' | 'copied' | 'failed';

export function CopyButton({
  value,
  children,
  className,
}: {
  /** What goes on the clipboard; null while there is nothing yet. */
  value: string | null;
  /** The label, naming what it copies ("Copy PIN"). */
  children: ReactNode;
  className?: string;
}) {
  const { t } = useLingui();
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state !== 'copied') return;
    const timer = setTimeout(() => setState('idle'), COPIED_MS);
    return () => clearTimeout(timer);
  }, [state]);
  // A new value (a new PIN) starts over.
  useEffect(() => setState('idle'), [value]);

  const copy = () => {
    if (value === null) return;
    navigator.clipboard.writeText(value).then(
      () => setState('copied'),
      () => setState('failed'),
    );
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={value === null}
        status={state === 'copied' ? 'success' : state === 'failed' ? 'error' : undefined}
        onClick={copy}
        className={className}
      >
        {state === 'copied' ? (
          <Check aria-hidden />
        ) : state === 'failed' ? (
          <CircleAlert aria-hidden />
        ) : (
          <Copy aria-hidden />
        )}
        {state === 'copied' ? t`Copied` : state === 'failed' ? t`Couldn’t copy` : children}
      </Button>
      <span role="status" className="sr-only">
        {state === 'copied' ? t`Copied` : ''}
      </span>
    </>
  );
}
