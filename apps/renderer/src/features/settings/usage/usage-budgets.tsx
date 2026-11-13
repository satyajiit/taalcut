// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · page: Settings › Usage › Budgets (P2-X1, UX4) · genre: atmospheric studio app (chrome modern-minimal) ·
 *   system: DESIGN.md v0.6 + UX4
 * what may be spent before a project stops to ask: the reassurance first (only you set or change a budget), then
 *   New projects and Your projects (budget-caps.tsx). Budgets aren't scoped by the period or the filters, so this
 *   view has no filter bar; the URL keeps them for the way back. A cap can be set before anything was ever spent,
 *   so this view has no empty state of its own.
 * states: as BudgetCaps */
import { Trans } from '@lingui/react/macro';
import { BudgetCaps } from './budget-caps';
import { UsageFrame } from './usage-frame';

export function UsageBudgets() {
  return (
    <UsageFrame
      current="budgets"
      description={<Trans>Only you can set or change a budget. Taalcut never raises one.</Trans>}
    >
      <BudgetCaps />
    </UsageFrame>
  );
}
