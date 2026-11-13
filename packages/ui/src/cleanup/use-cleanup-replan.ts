// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The cleanup card's plan (P3-V9): the agent's, until a switch asks for another (CardData.planCleanup, a read:
 * nothing changes); only the newest answer counts. Apply dispatches the plan shown, as the person
 * (timeline.applyCleanup), then says so with Undo. A refusal stays on the card as a value.
 */
import { useLingui } from '@lingui/react/macro';
import type { CardOf, CleanupPlan, ProjectId, TaalcutError } from '@taalcut/core';
import { useRef, useState } from 'react';
import { useCardActions } from '../cards/card-actions';
import { useCardData } from '../cards/card-data';
import { toast } from '../feedback/toast-store';
import { useFormatters } from '../lib/format';
import type { CleanupSwitchState } from './cleanup-switches';

/** CLEANUP_SETTING's switches (core's defaults: the kit reads core's types only). */
export const DEFAULT_SWITCHES: CleanupSwitchState = {
  fillers: true,
  pauses: true,
  retakes: true,
  punchIns: true,
  pauseThresholdMs: 500,
};

export const APPLY_CLEANUP = 'timeline.applyCleanup';

export function useCleanupReplan(card: CardOf<'cleanupPlan'>) {
  const { t } = useLingui();
  const format = useFormatters();
  const data = useCardData();
  const actions = useCardActions();
  const [switches, setSwitches] = useState<CleanupSwitchState>(DEFAULT_SWITCHES);
  const [plan, setPlan] = useState<CleanupPlan>(card.plan);
  const [planning, setPlanning] = useState<keyof CleanupSwitchState | 'check' | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [applied, setApplied] = useState(card.status === 'applied');
  const [applying, setApplying] = useState(false);
  const asked = useRef(0);

  const before = card.before;
  const after = plan === card.plan ? card.after : Math.max(0, before - plan.stats.secondsSaved);

  async function replan(next: CleanupSwitchState, which: keyof CleanupSwitchState | 'check') {
    setSwitches(next);
    if (!data.planCleanup) return;
    const ask = ++asked.current;
    setPlanning(which);
    setError(null);
    const result = await data.planCleanup({ timelineId: card.plan.timelineId, settings: next });
    if (ask !== asked.current) return;
    setPlanning(null);
    if (result.ok) setPlan(result.value);
    else setError(result.error);
  }

  async function apply(projectId: ProjectId) {
    if (!actions.dispatch) return;
    setApplying(true);
    setError(null);
    const result = await actions.dispatch(APPLY_CLEANUP, { projectId, timelineId: plan.timelineId, plan });
    setApplying(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setApplied(true);
    const shorter = format.duration(plan.stats.secondsSaved * 1000);
    const undo = actions.undo;
    toast({
      title: t`Cleaned up: ${shorter} shorter`,
      ...(undo
        ? {
            action: {
              label: t`Undo`,
              onSelect: () =>
                void undo().then((undone) => {
                  if (undone.ok) setApplied(false);
                }),
            },
          }
        : {}),
    });
  }

  return {
    switches,
    plan,
    before,
    after,
    planning,
    error,
    applied,
    applying,
    canPlan: Boolean(data.planCleanup),
    canApply: Boolean(actions.dispatch),
    replan,
    apply,
    clearError: () => setError(null),
  };
}
