// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The media cards' two kinds of button: a command on the bus (free, undoable from ⌘Z) and a follow-up to the run
 * (anything that costs money: the agent runs it behind its cost card). Each tracks which control is busy, the last
 * one that worked and the last error, by the control's key.
 */
import type { RunId, SelectionChip, TaalcutError } from '@taalcut/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMediaActions } from './media-actions';

export interface CommandRunner {
  /** False without a dispatch: the cards leave their buttons out. */
  readonly can: boolean;
  readonly busy: string | null;
  /** The last control whose command went through (its success state). */
  readonly done: string | null;
  readonly error: { readonly key: string; readonly error: TaalcutError } | null;
  /** Dispatches `name`; resolves true when it went through. */
  run(key: string, name: string, payload: unknown): Promise<boolean>;
  clear(): void;
}

export function useCommand(): CommandRunner {
  const { dispatch } = useMediaActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<CommandRunner['error']>(null);
  const mounted = useMounted();

  const run = useCallback(
    async (key: string, name: string, payload: unknown) => {
      if (!dispatch) return false;
      setBusy(key);
      setError(null);
      setDone(null);
      const result = await dispatch(name, payload);
      if (!mounted.current) return result.ok;
      setBusy(null);
      if (result.ok) setDone(key);
      else setError({ key, error: result.error });
      return result.ok;
    },
    [dispatch, mounted],
  );
  const clear = useCallback(() => {
    setError(null);
    setDone(null);
  }, []);
  return { can: dispatch !== undefined, busy, done, error, run, clear };
}

/** How a follow-up went: sent to the run, or put in the composer for the person to send. */
export type FollowUpOutcome = 'sent' | 'composer';

export interface FollowUp {
  readonly can: boolean;
  readonly busy: string | null;
  readonly outcome: { readonly key: string; readonly outcome: FollowUpOutcome } | null;
  readonly error: { readonly key: string; readonly error: TaalcutError } | null;
  /** Resolves true once the words are on their way (or in the composer). */
  send(key: string, text: string, selections?: readonly SelectionChip[]): Promise<boolean>;
}

/** A follow-up to `runId` (or the words in the composer when the app can't send one, or there is no run). */
export function useFollowUp(runId: RunId | undefined): FollowUp {
  const { followUp, ask } = useMediaActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<FollowUp['outcome']>(null);
  const [error, setError] = useState<FollowUp['error']>(null);
  const mounted = useMounted();

  const send = useCallback(
    async (key: string, text: string, selections: readonly SelectionChip[] = []) => {
      setError(null);
      setOutcome(null);
      if (!followUp || !runId) {
        if (!ask) return false;
        ask(text, selections);
        setOutcome({ key, outcome: 'composer' });
        return true;
      }
      setBusy(key);
      const result = await followUp(runId, text, selections);
      if (!mounted.current) return result.ok;
      setBusy(null);
      if (result.ok) setOutcome({ key, outcome: 'sent' });
      else setError({ key, error: result.error });
      return result.ok;
    },
    [ask, followUp, runId, mounted],
  );
  const can = (followUp !== undefined && runId !== undefined) || ask !== undefined;
  return { can, busy, outcome, error, send };
}

function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
