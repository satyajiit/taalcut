// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-TPL: one pool's fit, read through CardData.fitTemplates. Idle without a pool or without the reader (the card
 * shows nothing), loading on the first read, then the result or the failure; `retry` reads again. A new pool starts
 * over; a new `revision` of the same pool (its import finished) reads again with the answer kept on screen.
 */
import type { FitPool, FitTemplatesResult, TaalcutError } from '@taalcut/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCardData } from '../cards/card-data';
import { isReadFailure, READ_REJECTED } from '../cards/live-read';

export type TemplateFitState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly result: FitTemplatesResult; readonly key: string }
  | { readonly kind: 'failed'; readonly error: TaalcutError };

const keyOf = (pool: FitPool | null) => (pool ? JSON.stringify(pool) : null);

export function useTemplateFit(
  pool: FitPool | null,
  limit: number,
  revision = '',
): { readonly state: TemplateFitState; readonly retry: () => void } {
  const data = useCardData();
  const read = data.fitTemplates;
  const key = keyOf(pool);
  // The pool the key was made from: the effect runs when the key changes, not on every new object.
  const current = useRef(pool);
  current.current = pool;
  const [state, setState] = useState<TemplateFitState>({ kind: 'idle' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const asked = current.current;
    if (!read || key === null || asked === null) {
      setState({ kind: 'idle' });
      return;
    }
    let live = true;
    setState((before) => (before.kind === 'ready' && before.key === key ? before : { kind: 'loading' }));
    read(asked, limit).then(
      (answer) => {
        if (!live) return;
        setState(
          isReadFailure(answer)
            ? { kind: 'failed', error: answer.failed }
            : { kind: 'ready', result: answer, key },
        );
      },
      // A rejected read is a bug on the other side: the generic cause, which Try again may clear.
      () => {
        if (live) setState({ kind: 'failed', error: READ_REJECTED });
      },
    );
    return () => {
      live = false;
    };
  }, [read, key, limit, attempt, revision]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { state, retry };
}
