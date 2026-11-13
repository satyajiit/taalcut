// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { UsageBudgets } from '../../../features/settings/usage/usage-budgets';

/** Settings › Usage › Budgets: what a new project, and each project, may spend before it stops to ask. */
export const Route = createFileRoute('/settings/usage/budgets')({
  component: UsageBudgets,
});
