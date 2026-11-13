// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: budgets in Usage · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md
 *   v0.6 + UX4 (the kit's PageSection, SettingRow, Collapse; the motion grammar's Done)
 * two sections: New projects (the default cap as a switch row, its amount under it) and Your projects (one setting
 *   row per project: its name, the kit's cap meter, Change; Change opens an inline amount with Save, No budget and
 *   Cancel, and what is under it moves with it). Every change is an undoable command (⌘Z; a project's from the
 *   toast). A save that lands draws Save's tick, or Change's when the form has closed.
 * states: default · hover/focus/active (Change, Save) · disabled (another save running) · loading (Save spins) ·
 *   error (the amount line, or the command's cause under the row) · success (the tick, and the meter shows the new
 *   cap) · no cap ("No budget: it never stops to ask") · no projects (one line) */

import { Trans, useLingui } from '@lingui/react/macro';
import { BUDGET_COMMANDS, callRpc, type Money, type ProjectId, type TaalcutError } from '@taalcut/core';
import { CONCEPT_ICONS, PageSection, Skeleton, SUCCESS_HOLD_MS, toast } from '@taalcut/ui';
import { useEffect, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useCommand } from '../../../backend/use-command';
import { useBackendEvents } from '../../../backend/use-events';
import { useRpcQuery } from '../../../backend/use-rpc';
import { BoneRows, type BoneRowShape } from '../bones';
import { LoadError } from '../fields';
import { SettingRows } from '../rows';
import { SETTINGS_ICONS } from '../settings-icons';
import { SwitchRow } from '../switch-row';
import { CapForm, USD_2 } from './cap-form';
import { ProjectBudgetRow } from './project-budget-row';

const BUDGET_BONES: readonly BoneRowShape[] = [{ title: '30%', lines: ['64%'], control: 'switch' }];
const PROJECT_BONES: readonly BoneRowShape[] = ['22%', '18%', '26%'].map((title) => ({
  title,
  lines: ['70%', '24%'],
  control: 'button',
}));

/** The key whose save just landed, for SUCCESS_HOLD_MS: its button shows the tick. */
function useSavedFlash() {
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (saved === null) return;
    const timer = setTimeout(() => setSaved(null), SUCCESS_HOLD_MS);
    return () => clearTimeout(timer);
  }, [saved]);
  return [saved, setSaved] as const;
}

/**
 * Budgets (P2-X1): what a new project may spend before it stops to ask, and
 * each project's cap and spend. Only a person changes a cap (the bus refuses
 * the agent); each change is undoable with ⌘Z.
 */
export function BudgetCaps() {
  const { t } = useLingui();
  const backend = useBackend();
  const { run: dispatch } = useCommand({ toast: false });
  const defaults = useRpcQuery((signal) => backend.budget.defaults(undefined, { signal }), [backend]);
  const projects = useRpcQuery((signal) => backend.projects.list({}, { signal }), [backend]);
  useBackendEvents(['command.changed'], (event) => {
    if (event.payload.name === BUDGET_COMMANDS.setDefaultCap) defaults.reload();
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ key: string; error: TaalcutError } | null>(null);
  const [saved, setSaved] = useSavedFlash();
  const [lastDefault, setLastDefault] = useState<Money>(USD_2);

  const run = async (key: string, name: string, payload: unknown) => {
    setBusy(key);
    setFailure(null);
    setSaved(null);
    const result = await dispatch({ name, payload });
    // The tick and the end of the spinner in one render, so the button draws its tick from loading.
    if (result.ok) setSaved(key);
    else setFailure({ key, error: result.error });
    setBusy(null);
    return result.ok;
  };
  /**
   * A project's cap goes on that project's undo history, which ⌘Z here (app-wide) doesn't reach: the
   * toast's Undo does.
   */
  const setProjectCap = async (projectId: ProjectId, cap: Money | null) => {
    const done = await run(projectId, BUDGET_COMMANDS.setProjectCap, { projectId, cap });
    if (done)
      toast({
        title: t`Budget changed`,
        action: {
          label: t`Undo`,
          onSelect: () => void callRpc(backend.commands.undo({ projectId, source: 'ui' })),
        },
      });
    return done;
  };
  const setDefault = async (cap: Money | null) => {
    if (cap) setLastDefault(cap);
    else if (defaults.data?.projectCap) setLastDefault(defaults.data.projectCap);
    if (await run('default', BUDGET_COMMANDS.setDefaultCap, { cap })) defaults.reload();
  };

  if (!defaults.data)
    return defaults.status === 'error' ? (
      <LoadError
        error={defaults.error}
        onRetry={defaults.reload}
        what={<Trans>Budgets didn’t load.</Trans>}
      />
    ) : (
      <Skeleton name="settings-usage-budgets" loading fixture={<BoneRows rows={BUDGET_BONES} />}>
        {null}
      </Skeleton>
    );
  const cap = defaults.data.projectCap;
  // The same Skeleton as while loading: one instance from loading to loaded.
  return (
    <Skeleton name="settings-usage-budgets" loading={false} fixture={<BoneRows rows={BUDGET_BONES} />}>
      <div className="flex flex-col">
        <PageSection title={<Trans>New projects</Trans>} icon={SETTINGS_ICONS.budgets}>
          <SwitchRow
            data-setting="default-cap"
            label={<Trans>Give new projects a budget</Trans>}
            description={
              <Trans>
                A project stops before its cloud models spend more than this, and asks you what to do.
              </Trans>
            }
            checked={cap !== null}
            busy={busy === 'default' && cap === null}
            disabled={busy !== null && busy !== 'default'}
            error={failure?.key === 'default' ? failure.error : null}
            onChange={(on) => void setDefault(on ? lastDefault : null)}
          >
            {cap ? (
              <CapForm
                initial={cap}
                label={t`Budget for each new project`}
                busy={busy === 'default'}
                disabled={busy !== null && busy !== 'default'}
                saved={saved === 'default'}
                onSave={(next) => void setDefault(next)}
              />
            ) : null}
          </SwitchRow>
        </PageSection>
        <PageSection
          title={<Trans>Your projects</Trans>}
          icon={CONCEPT_ICONS.project}
          description={<Trans>Each project’s spend, all time, against its budget.</Trans>}
        >
          {projects.status === 'loading' ? (
            <Skeleton name="settings-usage-projects" loading fixture={<BoneRows rows={PROJECT_BONES} />}>
              {null}
            </Skeleton>
          ) : projects.status === 'error' && !projects.data ? (
            <LoadError
              error={projects.error}
              onRetry={projects.reload}
              what={<Trans>Your projects’ budgets didn’t load.</Trans>}
            />
          ) : (projects.data?.items.length ?? 0) === 0 ? (
            <p className="m-0 max-w-prose type-body text-ink-2">
              <Trans>No projects yet. Each video you make in a chat becomes one, with this budget.</Trans>
            </p>
          ) : (
            <SettingRows aria-label={t`Project budgets`}>
              {projects.data?.items.map((project) => (
                <ProjectBudgetRow
                  key={project.id}
                  projectId={project.id}
                  name={project.name}
                  defaultCap={cap}
                  busy={busy === project.id}
                  disabled={busy !== null && busy !== project.id}
                  saved={saved === project.id}
                  error={failure?.key === project.id ? failure.error : null}
                  onSet={(next) => setProjectCap(project.id, next)}
                />
              ))}
            </SettingRows>
          )}
        </PageSection>
      </div>
    </Skeleton>
  );
}
