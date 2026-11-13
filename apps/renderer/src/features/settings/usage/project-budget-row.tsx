// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: a project's budget row · genre: atmospheric studio app (chrome modern-minimal) · system:
 *   DESIGN.md v0.6 + UX4 (SettingRow, the kit's Collapse)
 * one setting row: the project's name (the person's words, as written), its cap meter or "No budget" line, and
 *   Change; Change opens the amount form under it (Collapse: what is under it moves with it), and the form's Cancel
 *   or a save closes it again. The cap is read on its own and again whenever any cap changes (here, the budget card,
 *   ⌘Z).
 * states: default · hover/focus/active (Change, Save) · disabled (another save running, or the cap not read yet) ·
 *   loading (Save spins) · error (the command's cause under the row; a cap that didn't load, with Try again) ·
 *   success (Change shows the tick for a moment, and the meter the new cap) · no cap (spent, and "No budget")
 * reduced motion: the form opens at once and fades in (Collapse) */
import { Trans, useLingui } from '@lingui/react/macro';
import { BUDGET_COMMANDS, type Money, type ProjectId, type TaalcutError } from '@taalcut/core';
import { Button, CapMeter, Collapse, useFormatters, useHostPlatform, VERB_ICONS } from '@taalcut/ui';
import { useId, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useBackendEvents } from '../../../backend/use-events';
import { useRpcQuery } from '../../../backend/use-rpc';
import { LoadError, Notice } from '../fields';
import { describeError } from '../model-messages';
import { SettingRow } from '../rows';
import { CapForm, USD_2 } from './cap-form';

export function ProjectBudgetRow({
  projectId,
  name,
  defaultCap,
  busy,
  disabled,
  saved,
  error,
  onSet,
}: {
  projectId: ProjectId;
  name: string;
  defaultCap: Money | null;
  busy: boolean;
  disabled: boolean;
  /** This row's last save just landed. */
  saved: boolean;
  error: TaalcutError | null;
  onSet: (cap: Money | null) => Promise<boolean>;
}) {
  const { t, i18n } = useLingui();
  const platform = useHostPlatform();
  const format = useFormatters();
  const backend = useBackend();
  const budget = useRpcQuery(
    (signal) => backend.budget.project({ projectId }, { signal }),
    [backend, projectId],
  );
  // A cap changed anywhere (here, the budget card, ⌘Z): read it again.
  useBackendEvents(['command.changed'], (event) => {
    if (event.payload.name === BUDGET_COMMANDS.setProjectCap) budget.reload();
  });
  const [editing, setEditing] = useState(false);
  // Each opening starts from the cap as it is now, not from what was typed the last time.
  const [opened, setOpened] = useState(0);
  const nameId = useId();
  const data = budget.data;
  const set = async (cap: Money | null) => {
    if (await onSet(cap)) {
      setEditing(false);
      budget.reload();
    }
  };
  const spent = data ? format.money(data.spent) : '';
  return (
    <SettingRow
      data-project={projectId}
      title={
        <span id={nameId} className="break-words" data-user-content>
          {name}
        </span>
      }
      description={
        !data ? null : data.cap ? (
          <CapMeter always cap={data.cap} spent={data.spent} />
        ) : (
          <span className="tabular-nums">
            <Trans>{spent} spent. No budget: it never stops to ask.</Trans>
          </span>
        )
      }
      control={
        editing ? null : (
          <Button
            variant="secondary"
            size="sm"
            icon={VERB_ICONS.edit}
            {...(saved ? { status: 'success' as const } : {})}
            disabled={disabled || !data}
            aria-describedby={nameId}
            onClick={() => {
              setOpened((n) => n + 1);
              setEditing(true);
            }}
          >
            <Trans>Change</Trans>
          </Button>
        )
      }
    >
      {data ? (
        <Collapse open={editing}>
          <div className="mt-2 border-t border-rule-subtle pt-3 pb-1">
            <CapForm
              key={opened}
              initial={data.cap ?? defaultCap ?? USD_2}
              fresh={!data.cap}
              label={t`Budget for this project`}
              busy={busy}
              disabled={disabled}
              saved={saved}
              focusOnOpen={opened > 0}
              onSave={(cap) => void set(cap)}
            >
              {data.cap ? (
                <Button variant="ghost" size="sm" disabled={disabled || busy} onClick={() => void set(null)}>
                  <Trans>No budget</Trans>
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(false)}>
                <Trans>Cancel</Trans>
              </Button>
            </CapForm>
          </div>
        </Collapse>
      ) : null}
      {error ? (
        <Notice tone="danger" role="alert">
          {describeError(i18n, error, platform)}
        </Notice>
      ) : null}
      {budget.status === 'error' && !data ? <LoadError error={budget.error} onRetry={budget.reload} /> : null}
    </SettingRow>
  );
}
