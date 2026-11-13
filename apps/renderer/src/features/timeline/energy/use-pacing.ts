// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Pacing tab's state (P3-V12), the same for the editor and the template page: the template's own curve, the
 * draft the bands change, the preview of the draft (asked 150 ms after the last change; nothing changes until
 * Apply), and Apply itself, a command on the bus whose toast's Undo is ⌘Z. A preview made for an older draft is
 * dropped; Apply sends the preview it shows. A wait longer than a moment is said: the project's queue is busy.
 */
import { useLingui } from '@lingui/react/macro';
import type { EnergyCurve, Result, TaalcutError, Template } from '@taalcut/core';
import { toast } from '@taalcut/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { energyCurveOf, sameCurve } from './energy-model';

/** What a draft would do, for the bands and the line under them. */
export interface PacingPreview<P> {
  readonly curve: EnergyCurve;
  /** The new cuts, in frames at the template's rate. */
  readonly cuts: readonly number[];
  /** Slots that change. */
  readonly changed: number;
  /** Shots picked again (the editor), 0 on a template. */
  readonly picks: number;
  /** A shot you locked sits in a changed section (it stays on the first new cut). */
  readonly lockedKept: boolean;
  /** The procedure's own answer, for Apply. */
  readonly plan: P;
}

export interface PacingSource<P> {
  /** The template version the bands read. */
  readonly template: Template;
  /** What Reset puts back in the draft (default-curve.ts). */
  readonly defaultCurve: EnergyCurve;
  readonly preview: (curve: EnergyCurve, signal: AbortSignal) => Promise<Result<PacingPreview<P>>>;
  readonly apply: (preview: PacingPreview<P>) => Promise<Result<unknown>>;
  /** The Undo on Apply's toast: the same as ⌘Z in this history. */
  readonly undo: () => Promise<Result<unknown>>;
}

export type PreviewState<P> =
  | { readonly status: 'idle' }
  | { readonly status: 'planning' }
  | { readonly status: 'ready'; readonly preview: PacingPreview<P> }
  | { readonly status: 'error'; readonly error: TaalcutError };

/** How long Apply waits before it says the project's queue is busy. */
const WAIT_SAYS_MS = 600;
const DEBOUNCE_MS = 150;

export function usePacing<P>(source: PacingSource<P>) {
  const { t } = useLingui();
  const { template } = source;
  const base = useMemo(() => energyCurveOf(template), [template]);
  const [draft, setDraft] = useState<EnergyCurve>(base);
  const [selected, setSelected] = useState(0);
  const [state, setState] = useState<PreviewState<P>>({ status: 'idle' });
  const [applying, setApplying] = useState<'no' | 'yes' | 'waiting'>('no');
  const [applyError, setApplyError] = useState<TaalcutError | null>(null);
  const latest = useRef(source);
  latest.current = source;

  // A new version (applied here, undone, or changed elsewhere): its own curve is the draft again.
  useEffect(() => {
    setDraft(base);
    setSelected((index) => Math.min(index, base.sections.length - 1));
    setState({ status: 'idle' });
  }, [base]);

  const edited = !sameCurve(draft, base);
  useEffect(() => {
    setApplyError(null);
    if (!edited) {
      setState({ status: 'idle' });
      return;
    }
    setState({ status: 'planning' });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void latest.current.preview(draft, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setState(
          result.ok ? { status: 'ready', preview: result.value } : { status: 'error', error: result.error },
        );
      });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft, edited]);

  const change = useCallback((next: EnergyCurve | null) => {
    if (next) setDraft(next);
  }, []);

  const apply = useCallback(async () => {
    if (state.status !== 'ready' || !sameCurve(state.preview.curve, draft)) return;
    setApplying('yes');
    setApplyError(null);
    const waiting = setTimeout(() => setApplying('waiting'), WAIT_SAYS_MS);
    const result = await latest.current.apply(state.preview);
    clearTimeout(waiting);
    setApplying('no');
    if (!result.ok) {
      setApplyError(result.error);
      return;
    }
    toast({
      title: t`Pacing changed`,
      action: {
        label: t`Undo`,
        onSelect: () =>
          void latest.current.undo().then((undone) => {
            if (!undone.ok) toast({ tone: 'danger', title: t`Couldn’t undo that` });
          }),
      },
    });
  }, [state, draft, t]);

  return {
    base,
    draft,
    edited,
    selected: Math.min(selected, draft.sections.length - 1),
    select: setSelected,
    change,
    /** The default curve back in the draft, previewed; Apply makes it a new version like any other. */
    reset: () => setDraft(source.defaultCurve),
    canReset: !sameCurve(draft, source.defaultCurve),
    state,
    apply,
    applying,
    applyError,
  };
}

export type Pacing<P> = ReturnType<typeof usePacing<P>>;
