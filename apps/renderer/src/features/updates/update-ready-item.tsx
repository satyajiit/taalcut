// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4
 * Hallmark · component: "Update ready" item · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a calm row for the sidebar's foot (the shell's owner mounts it): a download mark in
 *   primary-strong, "Update ready" at 500 and the version in ink-3, on no surface until pointed at. Shows only
 *   while an update is staged; pressing it opens the update dialog. Never pops up, never pulses.
 * states: default · hover (hover surface) · focus (base ring) · active (pressed) · disabled (n/a: it isn't shown
 *   without an update) · loading/error (n/a: it shows the state main reports) · success (the dialog opens)
 * contrast: pass (ink and ink-3 on the sidebar surface)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { cn } from '@taalcut/ui';
import { Download } from 'lucide-react';
import { openUpdateDialog } from './update-dialog-state';
import { readyUpdate, useUpdateState } from './use-updates';

/** The sidebar's "Update ready" item (apps/desktop SPEC, "Release notes in the update dialog"). */
export function UpdateReadyItem({ className }: { className?: string }) {
  const { t } = useLingui();
  const state = useUpdateState();
  const ready = readyUpdate(state.data);
  if (!ready) return null;
  const version = ready.version;
  return (
    <button
      type="button"
      data-slot="update-ready-item"
      onClick={openUpdateDialog}
      aria-label={t`Update ready: Taalcut ${version}. See what’s new.`}
      className={cn(
        'flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-start',
        'text-sm font-medium text-ink transition-colors duration-(--dur-micro) ease-(--ease-out)',
        'hover:bg-hover active:bg-pressed',
        className,
      )}
    >
      <Download aria-hidden className="size-4 shrink-0 text-primary-strong" />
      <span className="min-w-0 flex-1 truncate">
        <Trans>Update ready</Trans>
      </span>
      <span translate="no" className="shrink-0 text-xs font-normal text-ink-3 tabular-nums">
        {version}
      </span>
    </button>
  );
}
