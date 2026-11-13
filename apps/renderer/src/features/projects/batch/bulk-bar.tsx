// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · Operate · component: projects bulk bar (P3-V16, UX1, UX4) · system: DESIGN.md v0.6 + UX4 (panel,
 *   the kit's Checkbox)
 * while selecting, one quiet row above the list (in the flow, so it never covers a focused row): Select all, how
 *   many are picked and their videos, Apply a look… and Export all… (each opens its dialog), and Done, which
 *   leaves selection mode (Escape does too)
 * states: hidden (not selecting) · default (arrives once, Arrival) · nothing picked (the line says to pick, the
 *   actions are off) · no videos (the picked projects have none: the actions are off, the line says why) ·
 *   hover/active/focus-visible/disabled (Buttons; Select all is the kit's 24 px box, mixed when some are picked) · loading, error and
 *   success live in the dialogs and their toasts
 * pre-emit critique: P5 H4 E4 S5 R5 V4
 */
import { Plural, useLingui } from '@lingui/react/macro';
import type { ProjectSummary } from '@taalcut/core';
import { Arrival, Button, Checkbox, VERB_ICONS } from '@taalcut/ui';
import { Palette } from 'lucide-react';
import { useState } from 'react';
import { ApplyLookDialog } from './apply-look-dialog';
import { RenderAllDialog } from './render-all-dialog';

export interface BulkBarProps {
  /** The picked projects. */
  readonly projects: readonly ProjectSummary[];
  /** How many there are to pick from. */
  readonly total: number;
  readonly onSelectAll: (on: boolean) => void;
  /** Leaves selection mode. */
  readonly onDone: () => void;
}

/** Select all: the kit's Checkbox, checked when every project is picked, mixed when some are. */
function SelectAll({
  picked,
  total,
  onChange,
}: {
  picked: number;
  total: number;
  onChange: (on: boolean) => void;
}) {
  const { t } = useLingui();
  const all = picked > 0 && picked === total;
  return (
    <Checkbox
      data-slot="select-all"
      checked={all ? true : picked > 0 ? 'indeterminate' : false}
      aria-label={t`Select all projects`}
      onCheckedChange={onChange}
    />
  );
}

export function BulkBar({ projects, total, onSelectAll, onDone }: BulkBarProps) {
  const { t } = useLingui();
  const [dialog, setDialog] = useState<'look' | 'export' | null>(null);
  const videos = projects.reduce((sum, project) => sum + project.timelines, 0);
  const off = projects.length === 0 || videos === 0;
  return (
    <Arrival animate>
      <div
        role="toolbar"
        aria-label={t`Selected projects`}
        data-slot="projects-bulk-bar"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-panel py-2 ps-3 pe-3"
      >
        <SelectAll picked={projects.length} total={total} onChange={onSelectAll} />
        <span className="type-label text-ink" aria-live="polite">
          {projects.length === 0 ? (
            t`Pick the projects to export or restyle.`
          ) : (
            <>
              <Plural value={projects.length} one="# project selected" other="# projects selected" />
              <span className="text-ink-2">
                {' · '}
                {videos === 0 ? t`no videos yet` : <Plural value={videos} one="# video" other="# videos" />}
              </span>
            </>
          )}
        </span>
        <span className="ms-auto flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={off} onClick={() => setDialog('look')}>
            <Palette aria-hidden />
            {t`Apply a look…`}
          </Button>
          <Button size="sm" disabled={off} icon={VERB_ICONS.export} onClick={() => setDialog('export')}>
            {t`Export all…`}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDone}>
            {t`Done`}
          </Button>
        </span>
      </div>
      <ApplyLookDialog
        open={dialog === 'look'}
        onOpenChange={(open) => setDialog(open ? 'look' : null)}
        projects={projects}
      />
      <RenderAllDialog
        open={dialog === 'export'}
        onOpenChange={(open) => setDialog(open ? 'export' : null)}
        projectIds={projects.map((project) => project.id)}
      />
    </Arrival>
  );
}
