// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Everything the export dialog's sections read, loaded together so no section pops in late: the timeline (live,
 * so an undo from a toast shows at once), the export options at its revision, its Style (the intro and outro)
 * and the credits its stock asks for. The Style and the credits may fail without failing the dialog.
 */
import {
  fromRpcError,
  type Credits,
  type ExportOptions,
  type ProjectId,
  type Style,
  type TimelineId,
} from '@taalcut/core';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery, type Loadable } from '../../../backend/use-rpc';
import { useTimelineDocument } from '../../../backend/use-timeline-document';
import { timelineAssetIds } from './timeline-facts';
import type { CreditsState, ExportContext } from './types';

export function useExportContext(
  projectId: ProjectId,
  timelineId: TimelineId,
): Loadable<ExportContext> & { reload: () => void } {
  const backend = useBackend();
  const [round, setRound] = useState(0);
  const timeline = useTimelineDocument(timelineId);
  const revision = timeline.data?.revision;
  const options = useRpcQuery<ExportOptions>(
    (signal) => backend.renders.exportOptions({ projectId, timelineId }, { signal }),
    [backend, projectId, timelineId, revision, round],
  );
  const styleId = timeline.data?.styleId ?? null;
  const style = useRpcQuery<Style | null>(
    async (signal) => (styleId ? await backend.styles.get({ styleId }, { signal }).catch(() => null) : null),
    [backend, styleId],
  );
  const assets = timeline.data ? timelineAssetIds(timeline.data) : null;
  const assetKey = assets?.join(',') ?? null;
  const credits = useRpcQuery<CreditsState | null>(
    async (signal) => {
      if (!assets) return null;
      try {
        const lines: Credits = await backend.library.credits({ assetIds: assets.slice(0, 400) }, { signal });
        return { status: 'ready', credits: lines };
      } catch (cause) {
        return { status: 'error', error: fromRpcError(cause) };
      }
    },
    [backend, assetKey, round],
  );

  const reload = () => setRound((n) => n + 1);
  if (timeline.error && !timeline.data) return { status: 'error', error: timeline.error, reload };
  if (options.error && !options.data) return { status: 'error', error: options.error, reload };
  if (!timeline.data || !options.data || style.status === 'loading' || !credits.data)
    return { status: 'loading', reload };
  return {
    status: 'ready',
    data: {
      projectId,
      timelineId,
      options: options.data,
      timeline: timeline.data,
      style: style.data ?? null,
      credits: credits.data,
    },
    reload,
  };
}
