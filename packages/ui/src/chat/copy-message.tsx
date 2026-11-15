// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: copy-message · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.6 · the compact action under your own message: a small ghost Button whose own label is the
 *   feedback ("Copied" with a tick for 2.5 s, then back; no toast), so the words can go into another chat
 * states: default · hover · focus (base ring) · active (Button) · success ("Copied", announced politely) · error
 *   ("Couldn’t copy", until the next try) · loading: n/a (the clipboard answers at once) · disabled: n/a (a message
 *   with no words shows no button)
 * pre-emit critique: P5 H5 E5 S5 R5 V4 */

import { useLingui } from '@lingui/react/macro';
import { useEffect, useState } from 'react';
import { Button } from '#components/button';
import { VERB_ICONS } from '../icons/concepts';

const COPIED_MS = 2_500;

type CopyState = 'idle' | 'copied' | 'failed';

/** Puts a message's words on the clipboard, exactly as they were written. */
export function CopyMessage({ text }: { text: string }) {
  const { t } = useLingui();
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state !== 'copied') return;
    const timer = setTimeout(() => setState('idle'), COPIED_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = () => {
    const written = navigator.clipboard?.writeText(text);
    if (!written) return setState('failed');
    written.then(
      () => setState('copied'),
      () => setState('failed'),
    );
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={VERB_ICONS.copy}
        status={state === 'copied' ? 'success' : state === 'failed' ? 'error' : undefined}
        onClick={copy}
        data-slot="copy-message"
        className="h-7 px-2"
      >
        {state === 'copied' ? t`Copied` : state === 'failed' ? t`Couldn’t copy` : t`Copy`}
      </Button>
      <span role="status" className="sr-only">
        {state === 'copied' ? t`Copied` : ''}
      </span>
    </>
  );
}
