// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { callRpc, fromRpcError, type Result, type TaalcutError } from '@taalcut/core';
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

/**
 * A request's state. `data` is the last answer that arrived, kept while the next one loads and after a failure.
 * - New inputs (another clip, other filters): `loading`, with the last answer marked `stale` because it is for
 *   other inputs. Show bones, or the old content dimmed and busy, but never as current (UX1 X1).
 * - The same inputs read again (reload(), a change event): still `ready`, with `refreshing` set. The answer is
 *   still the right one: keep showing it with a quiet busy cue, never bones, so nothing flashes.
 */
export type Loadable<T> =
  | {
      readonly status: 'loading';
      readonly data?: T;
      readonly stale?: boolean;
      readonly refreshing?: undefined;
      readonly error?: undefined;
    }
  | {
      readonly status: 'ready';
      readonly data: T;
      readonly stale?: false;
      readonly refreshing?: boolean;
      readonly error?: undefined;
    }
  | {
      readonly status: 'error';
      readonly data?: T;
      readonly stale?: boolean;
      readonly refreshing?: undefined;
      readonly error: TaalcutError;
    };

/** What a query or stream hook returns: its state, and a way to ask again. */
export type Reloadable<T> = Loadable<T> & { readonly reload: () => void };

const LOADING = { status: 'loading', stale: false } as const;

/** The state while the answer for new inputs loads: the last answer stays, marked stale. */
export function loadingAfter<T>(previous: Loadable<T>): Loadable<T> {
  if (previous.data === undefined) return LOADING;
  return { status: 'loading', data: previous.data, stale: true };
}

/**
 * The state while the same inputs are read again: the answer stays current, `refreshing`. With no answer yet, or
 * one for other inputs (stale), it is plain loading.
 */
export function refreshingAfter<T>(previous: Loadable<T>): Loadable<T> {
  if (previous.data === undefined || previous.stale) return loadingAfter(previous);
  return { status: 'ready', data: previous.data, refreshing: true };
}

/**
 * The state after a request failed: the last answer stays beside the error, still marked stale when it was for
 * other inputs. After a failed re-read of the same inputs it is the right answer, only not the latest.
 */
export function failedAfter<T>(previous: Loadable<T>, error: TaalcutError): Loadable<T> {
  if (previous.data === undefined) return { status: 'error', error, stale: false };
  return { status: 'error', data: previous.data, stale: previous.stale === true, error };
}

function sameDeps(a: DependencyList, b: DependencyList): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

/**
 * The request's state, which goes back to loading (keeping the last answer, stale) the moment its inputs change,
 * in the same render, so no frame shows the old answer as the new one; reload() keeps the answer, refreshing.
 * React's pattern for state that follows props: compare with what the last render saw, and set state while
 * rendering.
 */
function useRequestState<T>(deps: DependencyList) {
  const [state, setState] = useState<Loadable<T>>(LOADING);
  const [round, setRound] = useState(0);
  const [seen, setSeen] = useState({ deps, round });
  if (!sameDeps(seen.deps, deps)) {
    setSeen({ deps, round });
    setState(loadingAfter);
  } else if (seen.round !== round) {
    setSeen({ deps, round });
    setState(refreshingAfter);
  }
  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { state, setState, round, reload };
}

/**
 * One request, run again when `deps` change or on reload(). Aborted on unmount and when a newer one starts. For
 * new inputs the status is `loading`, with the previous answer as stale `data` (UX1 W2-1); reload() keeps the
 * answer `ready` and `refreshing` (a change event that re-reads the same inputs should call it rather than bump
 * a counter in `deps`). A failure keeps the answer beside the error.
 */
export function useRpcQuery<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
): Reloadable<T> {
  const { state, setState, round, reload } = useRequestState<T>(deps);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const controller = new AbortController();
    loadRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) setState((prev) => failedAfter(prev, fromRpcError(cause)));
      },
    );
    return () => controller.abort();
    // The caller lists what the request depends on; `load` itself is read through a ref.
  }, [...deps, round]);

  return { ...state, reload };
}

/**
 * A stream that yields the current state first, then every change (the contract style for `changed`
 * procedures). The latest value wins. New `deps` open it again: `loading`, with the last value as stale `data`,
 * until the new stream's first value; reload() reopens it keeping the value, `refreshing`. A stream that fails
 * keeps its last value beside the error; reload() is the way to Try again.
 */
export function useRpcStream<T>(
  open: (signal: AbortSignal) => Promise<AsyncIterable<T>>,
  deps: DependencyList,
): Reloadable<T> {
  const { state, setState, round, reload } = useRequestState<T>(deps);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const value of await openRef.current(controller.signal)) {
          if (controller.signal.aborted) break;
          setState({ status: 'ready', data: value });
        }
      } catch (cause) {
        if (!controller.signal.aborted) setState((prev) => failedAfter(prev, fromRpcError(cause)));
      }
    })();
    return () => controller.abort();
    // The caller lists what the stream depends on.
  }, [...deps, round]);

  return { ...state, reload };
}

/** Wraps a call as a Result and tracks whether one is in flight. */
export function useRpcAction<I, O>(
  call: (input: I) => Promise<O>,
): { run: (input: I) => Promise<Result<O>>; pending: boolean } {
  const [pending, setPending] = useState(0);
  const callRef = useRef(call);
  callRef.current = call;
  const run = useCallback(async (input: I) => {
    setPending((n) => n + 1);
    try {
      return await callRpc(callRef.current(input));
    } finally {
      setPending((n) => n - 1);
    }
  }, []);
  return { run, pending: pending > 0 };
}
