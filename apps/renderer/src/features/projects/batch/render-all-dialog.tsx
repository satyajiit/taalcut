// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: export-all dialog (P3-V16, UX1) · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.4
 * every video of the picked projects exported at once: where they're going (an export preset) and whether to be
 *   told when they're done; Export all dispatches one render.exportBatch, then Exports follows it
 * states: loading (counting the videos: Export all off) · default · no videos · too many (over 50) · counting
 *   failed (the cause and Try again) · exporting (Export all loading, keeps focus) · error (the cause under the
 *   choices) · success (closes; the toast opens Exports)
 * pre-emit critique: P4 H5 E4 S5 R4 V4
 */
import { Plural, useLingui } from '@lingui/react/macro';
import { callRpc, EXPORT_PRESET_IDS, newId, RENDER_COMMANDS, type ExportPresetId } from '@taalcut/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  errorMessage,
  PRESET_LABELS,
  toast,
  VERB_ICONS,
} from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { Select } from '../../settings/fields';
import { LoadError } from '../../make/load-error';
import { BATCH_LIMIT, videosOf } from './use-apply-look';
import type { ProjectId } from '@taalcut/core';

export interface RenderAllDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly projectIds: readonly ProjectId[];
}

export function RenderAllDialog({ open, onOpenChange, projectIds }: RenderAllDialogProps) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const navigate = useNavigate();
  const id = useId();
  const [preset, setPreset] = useState<ExportPresetId>('shorts');
  const [notify, setNotify] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  const videos = useRpcQuery(
    (signal) => (open ? videosOf(backend, projectIds, signal) : Promise.resolve([])),
    [backend, open, projectIds.join()],
  );
  const items = videos.data ?? [];
  const tooMany = items.length > BATCH_LIMIT;
  const ready = videos.status === 'ready' && items.length > 0 && !tooMany;

  const exportAll = async () => {
    setSending(true);
    setError(null);
    const sent = await callRpc(
      backend.commands.dispatch({
        name: RENDER_COMMANDS.exportBatch,
        payload: {
          batchId: newId<'RenderBatch'>(),
          items: items.map((item) => ({ ...item, presetId: preset })),
          mode: 'export',
          notify,
        },
        source: 'ui',
        idempotencyKey: newId(),
      }),
    );
    setSending(false);
    if (!sent.ok) return setError(errorMessage(i18n, sent.error));
    onOpenChange(false);
    toast({
      title: <Plural value={items.length} one="Exporting # video" other="Exporting # videos" />,
      action: { label: t`Open Exports`, onSelect: () => void navigate({ to: '/renders' }) },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-slot="render-all-dialog">
        <DialogHeader>
          <DialogTitle>{t`Export all`}</DialogTitle>
          <DialogDescription>
            {t`Every video of the projects you picked is exported. Each one is checked before it’s saved.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-preset`} className="text-sm font-medium text-ink">
            {t`Where they’re going`}
          </label>
          <Select
            id={`${id}-preset`}
            value={preset}
            onChange={(event) => {
              const next = EXPORT_PRESET_IDS.find((value) => value === event.target.value);
              if (next) setPreset(next);
            }}
          >
            {EXPORT_PRESET_IDS.map((value) => (
              <option key={value} value={value}>
                {i18n._(PRESET_LABELS[value])}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex min-h-6 cursor-pointer items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={notify}
            onChange={(event) => setNotify(event.target.checked)}
            className="size-4 shrink-0 accent-ink"
          />
          {t`Tell me when they’re done`}
        </label>
        <p aria-live="polite" className="m-0 min-h-5 text-sm text-ink-2">
          {videos.status === 'error' ? null : videos.status !== 'ready' ? (
            t`Counting the videos…`
          ) : items.length === 0 ? (
            t`These projects have no videos yet.`
          ) : tooMany ? (
            t`That’s more than 50 videos. Pick fewer projects: up to 50 export at once.`
          ) : (
            <Plural value={items.length} one="# video will be exported." other="# videos will be exported." />
          )}
        </p>
        {videos.error ? <LoadError error={videos.error} onRetry={videos.reload} /> : null}
        {error ? (
          <p role="alert" className="m-0 text-sm text-danger-strong">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t`Cancel`}
          </Button>
          <Button
            variant="primary"
            icon={VERB_ICONS.export}
            disabled={!ready}
            loading={sending}
            onClick={() => void exportAll()}
          >
            {t`Export all`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
