// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Clean up panel's plan (P3-V9): asked with the panel's switches (timelines.planCleanup, a read), again 150 ms
 * after the last change and only the newest answer counts; shown on the bed while it matches the video; Apply
 * sends the plan shown (timeline.applyCleanup, as the person) and says so with Undo. A plan the video has moved
 * past is stale until it is checked again.
 */
import { useLingui } from '@lingui/react/macro';
import {
  callRpc,
  newId,
  TIMELINE_COMMANDS,
  type CleanupPlan,
  type ProjectId,
  type TaalcutError,
  type Timeline,
} from '@taalcut/core';
import { DEFAULT_SWITCHES, toast, useFormatters, type CleanupSwitchState } from '@taalcut/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { showCleanupPreview } from './cleanup-preview';

const DEBOUNCE_MS = 150;

export type CleanupPlanState =
  | { readonly status: 'analysing' }
  | { readonly status: 'ready'; readonly plan: CleanupPlan }
  | { readonly status: 'error'; readonly error: TaalcutError };

export function useCleanupPlan(projectId: ProjectId, timeline: Timeline) {
  const { t } = useLingui();
  const backend = useBackend();
  const format = useFormatters();
  const [switches, setSwitches] = useState<CleanupSwitchState>(DEFAULT_SWITCHES);
  const [state, setState] = useState<CleanupPlanState>({ status: 'analysing' });
  const [planning, setPlanning] = useState(false);
  const [round, setRound] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<number | null>(null);
  const [applyError, setApplyError] = useState<TaalcutError | null>(null);
  const timelineId = timeline.id;
  const asked = useRef(0);

  useEffect(() => {
    const ask = ++asked.current;
    const controller = new AbortController();
    setPlanning(true);
    const timer = setTimeout(() => {
      void callRpc(
        backend.timelines.planCleanup({ timelineId, settings: switches }, { signal: controller.signal }),
      ).then((result) => {
        if (ask !== asked.current) return;
        setPlanning(false);
        setState(
          result.ok ? { status: 'ready', plan: result.value } : { status: 'error', error: result.error },
        );
      });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [backend, timelineId, switches, round]);

  const plan = state.status === 'ready' ? state.plan : null;
  const stale = plan !== null && plan.revision !== timeline.revision && applied === null;

  // The bed marks the plan while it is the video's; never once it's applied or stale.
  useEffect(() => {
    showCleanupPreview(plan && !stale && applied === null ? plan : null);
  }, [plan, stale, applied]);
  useEffect(() => () => showCleanupPreview(null), []);

  const change = useCallback((next: CleanupSwitchState) => {
    setApplied(null);
    setApplyError(null);
    setSwitches(next);
  }, []);
  const checkAgain = useCallback(() => {
    setApplied(null);
    setApplyError(null);
    setRound((n) => n + 1);
  }, []);

  const apply = useCallback(async () => {
    if (!plan) return;
    setApplying(true);
    setApplyError(null);
    const result = await callRpc(
      backend.commands.dispatch({
        name: TIMELINE_COMMANDS.applyCleanup,
        payload: { projectId, timelineId, plan },
        source: 'ui',
        idempotencyKey: newId(),
      }),
    );
    setApplying(false);
    if (!result.ok) {
      setApplyError(result.error);
      return;
    }
    setApplied(plan.stats.secondsSaved);
    const shorter = format.duration(plan.stats.secondsSaved * 1000);
    toast({
      title: t`Cleaned up: ${shorter} shorter`,
      action: {
        label: t`Undo`,
        onSelect: () =>
          void callRpc(backend.commands.undo({ projectId, source: 'ui' })).then((undone) => {
            if (!undone.ok) {
              toast({ tone: 'danger', title: t`Couldn’t undo that` });
              return;
            }
            // The video is as it was: plan it again, so the panel and the bed show it.
            setApplied(null);
            setRound((n) => n + 1);
          }),
      },
    });
  }, [plan, backend, projectId, timelineId, format, t]);

  return { switches, change, state, plan, planning, stale, checkAgain, apply, applying, applied, applyError };
}
