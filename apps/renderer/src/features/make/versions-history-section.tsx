// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Trans, useLingui } from '@lingui/react/macro';
import type { ProjectId } from '@taalcut/core';
import { Button, toolLabel, VERB_ICONS } from '@taalcut/ui';
import { useProjectUndo } from '../timeline/use-project-undo';

/**
 * The project's live Edit History / Steps section inside the Versions / History panel.
 * Shows the most recent command or AI edit turn and provides Undo and Redo controls
 * in one dedicated place instead of repeating Undo buttons on every chat card.
 */
export function VersionsHistorySection({ projectId }: { projectId: ProjectId }) {
  const { t, i18n } = useLingui();
  const undo = useProjectUndo(projectId);
  const undoToolName = undo.undo ? toolLabel(i18n, undo.undo) : '';
  const undoStepName = undo.undo
    ? undo.undoTurn
      ? t`Last chat edit (${undoToolName})`
      : undoToolName
    : null;
  const redoToolName = undo.redo ? toolLabel(i18n, undo.redo) : '';
  const redoStepName = undo.redo
    ? undo.redoTurn
      ? t`Chat edit (${redoToolName})`
      : redoToolName
    : null;

  return (
    <div
      data-slot="edit-history-section"
      className="flex flex-col gap-2 rounded-lg border border-rule-subtle bg-sunken p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-2">{t`Edit history`}</span>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            icon={VERB_ICONS.undo}
            disabled={!undo.undo || undo.busy !== null}
            loading={undo.busy === 'undo'}
            onClick={() => void undo.run('undo')}
          >
            {t`Undo`}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={VERB_ICONS.redo}
            disabled={!undo.redo || undo.busy !== null}
            loading={undo.busy === 'redo'}
            onClick={() => void undo.run('redo')}
          >
            {t`Redo`}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-1 text-xs text-ink-2">
        {undoStepName ? (
          <p className="m-0">
            <Trans>Latest step: {undoStepName}</Trans>
          </p>
        ) : (
          <p className="m-0">{t`No recent steps to undo.`}</p>
        )}
        {redoStepName ? (
          <p className="m-0 text-ink-3">
            <Trans>Ready to redo: {redoStepName}</Trans>
          </p>
        ) : null}
      </div>
    </div>
  );
}
