// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: export dialog (P2-M11, UX1, UX4) · system: DESIGN.md v0.6 + UX4
 * from the timeline (?export=1), from Exports (More options…), from a project's More menu and from the export card.
 *   It stays a dialog (a short, focused task over the editor that ends in a job the dialog then follows), but its
 *   choices are steps now: where it's going, sound, captions, framing, credits, then a summary and Export
 *   (ExportForm). Then the same dialog follows the export (ExportFollow), down to the moment it ends. No path skips
 *   the checks: every export is checked before it's saved.
 * states: choosing (ExportForm's) · following (ExportFollow's) · the dialog's own (opens on the first step's
 *   heading, not its close button; Escape and the close button leave; focus goes back to what opened it)
 * motion: the dialog's own pop; the steps crossfade; the follow arrives (Arrival: opacity and 8 px); reduced
 *   motion: fades
 */
import { useLingui } from '@lingui/react/macro';
import type { ExportPresetId, ProjectId, RenderId, TimelineId } from '@taalcut/core';
import {
  Arrival,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@taalcut/ui';
import { useEffect, useState } from 'react';
import { ExportFollow } from './export-follow';
import { ExportForm } from './export-form';

export interface ExportDialogProps {
  projectId: ProjectId;
  timelineId: TimelineId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Start on this preset (Export again from a render); default: the project's. */
  presetId?: ExportPresetId | undefined;
}

export function ExportDialog({ projectId, timelineId, open, onOpenChange, presetId }: ExportDialogProps) {
  const { t } = useLingui();
  const [renderId, setRenderId] = useState<RenderId | null>(null);
  useEffect(() => {
    if (!open) setRenderId(null);
  }, [open]);
  const close = () => onOpenChange(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100vh-4rem)] max-w-3xl flex-col overflow-hidden"
        data-slot="export-dialog"
        // The first step's heading takes focus once it is there (ExportStepBody), not the close button.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus({ preventScroll: true });
        }}
      >
        {open ? (
          // The choices show at once with the dialog; following the export arrives (opacity and 8 px).
          <Arrival
            key={renderId ?? 'choose'}
            animate={renderId !== null}
            className={cn('flex min-h-0 flex-1 flex-col gap-4', renderId && '-ms-1 -mt-1 overflow-y-auto p-1')}
          >
            {renderId ? (
              <ExportFollow
                projectId={projectId}
                renderId={renderId}
                onRestart={() => setRenderId(null)}
                close={close}
              />
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>{t`Export`}</DialogTitle>
                  <DialogDescription>{t`Choose where it’s going. Taalcut checks it before it’s saved.`}</DialogDescription>
                </DialogHeader>
                <ExportForm
                  projectId={projectId}
                  timelineId={timelineId}
                  presetId={presetId}
                  onStarted={setRenderId}
                  onCancel={close}
                />
              </>
            )}
          </Arrival>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
