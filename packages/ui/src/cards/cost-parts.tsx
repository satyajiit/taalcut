// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: cap meter · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * a neutral bar (never a status colour on its own): what is spent in ink-2, what's next in ink-3, the rest of the
 *   cap as the track; the words say it, and over the cap a warning icon and a sentence join them
 * states: not interactive · nothing spent (shown only where the budget is the subject: `always`) · some spent ·
 *   near the cap (what is left joins in) · at or over the cap (warning icon and words)
 * UX3-AGT: says what is spent, never "the whole budget left" as news */

import { useLingui } from '@lingui/react/macro';
import type {
  BUDGET_COMMANDS,
  CHATGPT_PROVIDER,
  CHATGPT_IMAGE_PROVIDER,
  CheaperOption,
  MODEL_COMMANDS,
  Money,
} from '@taalcut/core';
import { TriangleAlert } from 'lucide-react';
import { useFormatters } from '#lib/format';

// The kit imports only types from core: the names are checked against core's at compile time.
const SET_OVERRIDE: (typeof MODEL_COMMANDS)['setModuleOverride'] = 'models.setModuleOverride';
export const SET_PROJECT_CAP: (typeof BUDGET_COMMANDS)['setProjectCap'] = 'project.setBudgetCap';
const CHATGPT_PLAN: typeof CHATGPT_PROVIDER = 'openai-codex';
const CHATGPT_IMAGES_PLAN: typeof CHATGPT_IMAGE_PROVIDER = 'openai-codex-images';

/** A line or option on the person's ChatGPT plan (UX3-AGT): it bills the plan, so it has no money to show. */
export const onPlan = (provider: string): boolean =>
  provider === CHATGPT_PLAN || provider === CHATGPT_IMAGES_PLAN;

/** The composer's command for a model: the same switch Settings makes, global and undoable. */
export function overrideCommand(option: CheaperOption): [string, unknown] {
  return [
    SET_OVERRIDE,
    { module: option.module, override: { primary: { provider: option.provider, model: option.model } } },
  ];
}

const share = (part: number, whole: number) => (whole <= 0 ? 1 : Math.max(0, Math.min(1, part / whole)));

/** From this share of the cap on, what is left is worth saying too. */
export const NEAR_CAP_SHARE = 0.8;

export interface CapMeterProps {
  cap: Money;
  spent: Money;
  /** The next step's estimate, drawn after what is spent. */
  next?: Money | undefined;
  /**
   * Where the budget is the subject (Settings › Usage, the over-the-budget card): shown with nothing spent yet too.
   * Elsewhere a budget nobody has touched isn't news, so the meter shows nothing.
   */
  always?: boolean;
}

export type CapState = 'untouched' | 'spending' | 'near' | 'over';

/** Where a project stands against its budget, the next step included. */
export function capState({ cap, spent, next }: Pick<CapMeterProps, 'cap' | 'spent' | 'next'>): CapState {
  if (spent.micros + (next?.micros ?? 0) > cap.micros) return 'over';
  if (spent.micros <= 0) return 'untouched';
  return spent.micros >= NEAR_CAP_SHARE * cap.micros ? 'near' : 'spending';
}

/** The project's budget: what is spent (then the next step) against it, and what is left once that is near. */
export function CapMeter({ cap, spent, next, always = false }: CapMeterProps) {
  const { t } = useLingui();
  const format = useFormatters();
  const state = capState({ cap, spent, next });
  if (state === 'untouched' && !always) return null;
  const used = share(spent.micros, cap.micros);
  const coming = next ? share(spent.micros + next.micros, cap.micros) : used;
  const over = state === 'over';
  const capText = format.money(cap);
  const leftText = format.money({ ...cap, micros: Math.max(0, cap.micros - spent.micros) });
  const spentText = format.money(spent);
  const words = {
    untouched: t`Nothing spent yet of this project’s ${capText} budget.`,
    spending: t`${spentText} spent of this project’s ${capText} budget.`,
    near: t`${spentText} spent of this project’s ${capText} budget: ${leftText} left.`,
    over: t`${spentText} spent of this project’s ${capText} budget: the next step would go over.`,
  }[state];
  return (
    <div
      data-slot="cap-meter"
      data-state={state}
      data-over={over || undefined}
      className="flex flex-col gap-1.5"
    >
      <div
        role="meter"
        aria-label={t`Project budget`}
        aria-valuemin={0}
        aria-valuemax={cap.micros / 1_000_000}
        aria-valuenow={Math.min(spent.micros, cap.micros) / 1_000_000}
        aria-valuetext={t`${spentText} of ${capText} spent`}
        className="relative h-1.5 overflow-hidden rounded-pill bg-hover"
      >
        <span
          className="absolute inset-0 origin-left rounded-pill bg-ink-3 transition-transform duration-(--dur-short) ease-(--ease-out)"
          style={{ transform: `scaleX(${coming})` }}
        />
        <span
          className="absolute inset-0 origin-left rounded-pill bg-ink-2 transition-transform duration-(--dur-short) ease-(--ease-out)"
          style={{ transform: `scaleX(${used})` }}
        />
      </div>
      <p className="m-0 flex items-start gap-1.5 text-xs text-ink-2 tabular-nums">
        {over ? <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-warning-strong" /> : null}
        <span>{words}</span>
      </p>
    </div>
  );
}
