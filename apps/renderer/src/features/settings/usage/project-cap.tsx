// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: a project's budget in Usage · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.3
 * the kit's CapMeter against what the project has spent in all (a cap bounds the whole project, not a day or a
 *   period); "No budget" in ink-3 when it has none. Follows cap changes made anywhere (command.changed).
 * states: default · loading (nothing until the budget arrives: the row keeps its height) · error (one ink-3
 *   line) · success (the meter) · hover/focus/active/disabled (n/a: reading only)
 */
import { Trans } from '@lingui/react/macro';
import { BUDGET_COMMANDS, type ProjectId } from '@taalcut/core';
import { CapMeter } from '@taalcut/ui';
import { useBackend } from '../../../backend/backend';
import { useBackendEvents } from '../../../backend/use-events';
import { useRpcQuery } from '../../../backend/use-rpc';

export function ProjectCap({ projectId }: { projectId: ProjectId }) {
  const backend = useBackend();
  const budget = useRpcQuery(
    (signal) => backend.budget.project({ projectId }, { signal }),
    [backend, projectId],
  );
  useBackendEvents(['command.changed'], (event) => {
    if (event.payload.name === BUDGET_COMMANDS.setProjectCap) budget.reload();
  });
  if (budget.status === 'error' && !budget.data)
    return (
      <p className="m-0 type-meta text-ink-3">
        <Trans>The budget didn’t load.</Trans>
      </p>
    );
  if (!budget.data) return <span aria-hidden className="block h-1.5" />;
  return budget.data.cap ? (
    <CapMeter always cap={budget.data.cap} spent={budget.data.spent} />
  ) : (
    <p className="m-0 type-meta text-ink-3">
      <Trans>No budget</Trans>
    </p>
  );
}
