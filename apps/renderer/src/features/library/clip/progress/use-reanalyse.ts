// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Analyse again (`library.reindexAssets`) for one clip, shared by every place that offers it: the window bar's
 * More menu, the failed step's fix, the viewer's plate when the copy to play is gone (LIB1-PROG). It can't be
 * pressed twice. It is busy while the command runs, then stays *asked* until the clip's detail says its steps are
 * pending again: the model-download lesson (use-model-downloads.ts), where a button that came back between the
 * click and the work starting got pressed again. An ask the library never shows within a while lets go, so a
 * button is never stuck.
 */
import { LIBRARY_COMMANDS, type AssetDetail, type AssetId, type TaalcutError } from '@taalcut/core';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useCommand } from '../../../../backend/use-command';

/** How long an ask waits for the steps to show as pending before it lets go. */
export const ASK_HOLD_MS = 15_000;

type Ask = { readonly phase: 'running' | 'asked'; readonly at: number };

const asks = new Map<string, Ask>();
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function publish(): void {
  for (const listener of listeners) listener();
}

function set(assetId: string, ask: Ask | null): void {
  clearTimeout(timers.get(assetId));
  timers.delete(assetId);
  if (ask) asks.set(assetId, ask);
  else asks.delete(assetId);
  if (ask?.phase === 'asked')
    timers.set(
      assetId,
      setTimeout(() => set(assetId, null), ASK_HOLD_MS),
    );
  publish();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The clip's detail says the work runs again: a step waits its turn, is queued or runs, none has failed, and the
 * clip counts as being looked at. A failed clip's later steps wait too, so pending steps alone don't answer an ask.
 */
export function analysisStarted(detail: Pick<AssetDetail, 'stages' | 'asset'>): boolean {
  return (
    analysing(detail) &&
    !detail.stages.some((stage) => stage.state === 'failed') &&
    detail.stages.some(
      (stage) => stage.state === 'waiting' || stage.state === 'queued' || stage.state === 'running',
    )
  );
}

/** Taalcut is looking at the clip already, or waits to: Analyse again has nothing to add. */
export function analysing(detail: Pick<AssetDetail, 'asset'>): boolean {
  const state = detail.asset.index.state;
  return state === 'indexing' || state === 'waiting';
}

export interface ReanalyseResult {
  readonly ok: boolean;
  /** Why the library refused; null when it ran, or when the ask was already out. */
  readonly error: TaalcutError | null;
}

export interface Reanalyse {
  /** Analyse the clip again; does nothing while it is busy. */
  readonly run: () => Promise<ReanalyseResult>;
  /** The command runs, or ran and the clip's steps don't say so yet: show it busy, and don't offer it again. */
  readonly busy: boolean;
  /** It can be pressed: not busy, not removed, not already being looked at. */
  readonly available: boolean;
  /** The last ask's refusal, until the next ask. */
  readonly error: TaalcutError | null;
}

const errors = new Map<string, TaalcutError>();

/**
 * Analyse again for one clip; `detail` is the clip as the page last read it (undefined while it loads).
 * `onStarted` runs once the command is through, to read the clip again.
 */
export function useReanalyse(
  assetId: AssetId,
  detail: AssetDetail | undefined,
  onStarted?: () => void,
): Reanalyse {
  const command = useCommand({ toast: false });
  const ask = useSyncExternalStore(
    subscribe,
    () => asks.get(assetId),
    () => undefined,
  );
  const error = useSyncExternalStore(
    subscribe,
    () => errors.get(assetId) ?? null,
    () => null,
  );
  // The work shows: the ask is answered.
  const started = detail !== undefined && analysisStarted(detail);
  useEffect(() => {
    if (ask?.phase === 'asked' && started) set(assetId, null);
  }, [ask, started, assetId]);

  const busy = ask !== undefined;
  const available = !busy && detail !== undefined && !detail.asset.trashed && !analysing(detail);
  const { run: dispatch } = command;
  // Read at the press, not at the render: a press from a view that hasn't caught up with the clip yet.
  const latest = useRef(detail);
  latest.current = detail;
  const run = useCallback(async (): Promise<ReanalyseResult> => {
    const now = latest.current;
    if (asks.has(assetId) || (now !== undefined && analysing(now))) return { ok: false, error: null };
    set(assetId, { phase: 'running', at: Date.now() });
    const result = await dispatch({
      name: LIBRARY_COMMANDS.reindexAssets,
      payload: { assetIds: [assetId] },
    });
    if (result.ok) errors.delete(assetId);
    else errors.set(assetId, result.error);
    set(assetId, result.ok ? { phase: 'asked', at: Date.now() } : null);
    if (result.ok) onStarted?.();
    return result.ok ? { ok: true, error: null } : { ok: false, error: result.error };
  }, [dispatch, assetId, onStarted]);
  return { run, busy, available, error };
}

/** Tests: forget every ask. */
export function resetReanalyse(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  asks.clear();
  errors.clear();
  publish();
}
