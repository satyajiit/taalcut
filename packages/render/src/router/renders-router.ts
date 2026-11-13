// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.renders, served by the render process (UTILITY_CONTRACTS.render.renders):
 * presets, export options, the renders list and its live updates, QA
 * reports, media URLs, preview sessions and subtitle text. It only reads;
 * every change is a command on the agent's bus.
 */
import {
  err,
  implementContract,
  NotFoundError,
  ok,
  rendersContract,
  unwrapRpc,
  type AsyncResult,
  type ProjectId,
  type RenderSnapshot,
  type RenderStore,
  type TimelineId,
} from '@taalcut/core';
import { coverImage } from '../cover/cover-image';
import { toSrt, toVtt } from '../captions/subtitles';
import type { RenderEngineDeps } from '../engine/deps';
import type { LiveRenders } from '../engine/live';
import type { PreviewSessions } from '../engine/previews';
import { EXPORT_PRESETS } from '../presets/presets.v1';
import { batchProgress } from '../batch/batch-progress';
import { exportOptions, type ExportOptionsDeps } from './export-options';
import { pollWatch } from './poll-watch';
import { renderMediaUrl } from './media-url';
import { listSnapshots, snapshotOf } from './snapshot';

/** How often `watch` rereads the store for writes made by other processes (the agent's commands). */
export const WATCH_POLL_MS = 1_000;

export interface RendersRouterOptions extends ExportOptionsDeps {
  readonly pollMs?: number;
}

const never = new AbortController().signal;

/**
 * The renders list now, then again whenever it changes: on this process's progress and writes
 * (live.onChange) and on a store poll. A list equal to the last one sent is not sent again.
 */
export async function* watchRenders(
  store: RenderStore,
  live: Pick<LiveRenders, 'progress' | 'onChange'>,
  projectId: ProjectId | undefined,
  signal: AbortSignal,
  pollMs: number = WATCH_POLL_MS,
): AsyncGenerator<RenderSnapshot[]> {
  yield* pollWatch(
    async () => unwrapRpc(await listSnapshots(store, live, projectId ? { projectId } : {})),
    live,
    signal,
    pollMs,
  );
}

/** File names a download dialog accepts: no separators, controls or reserved characters. */
export function subtitleFileName(name: string, format: 'srt' | 'vtt'): string {
  const base = Array.from(name.normalize('NFC'))
    .filter((char) => (char.codePointAt(0) ?? 0) >= 0x20 && char !== '\u007f')
    .join('')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 190);
  return `${base || 'captions'}.${format}`;
}

async function subtitles(
  deps: RenderEngineDeps,
  input: {
    projectId: ProjectId;
    timelineId: TimelineId;
    format: 'srt' | 'vtt';
    wordTimestamps?: boolean | undefined;
  },
): AsyncResult<{ fileName: string; text: string }> {
  const timeline = await deps.timelines.get(input.timelineId);
  if (!timeline.ok) return timeline;
  const { value } = timeline;
  if (value.projectId !== input.projectId)
    return err(NotFoundError({ entity: 'timeline', id: input.timelineId }));
  if (!value.captions) return err(NotFoundError({ entity: 'captions', id: input.timelineId }));
  const rate = value.canvas.rate;
  const text =
    input.format === 'srt'
      ? toSrt(value.captions, rate)
      : toVtt(value.captions, rate, input.wordTimestamps ? { wordTimestamps: true } : {});
  return ok({ fileName: subtitleFileName(value.name, input.format), text });
}

export function rendersRouter(
  deps: RenderEngineDeps,
  live: LiveRenders,
  previews: PreviewSessions,
  options: RendersRouterOptions = {},
) {
  const os = implementContract(rendersContract);
  return os.router({
    coverImage: os.coverImage.handler(async ({ input, signal }) =>
      unwrapRpc(await coverImage(deps, input, signal ? { signal } : {})),
    ),
    presets: os.presets.handler(async () => [...EXPORT_PRESETS]),
    exportOptions: os.exportOptions.handler(async ({ input }) =>
      unwrapRpc(await exportOptions(deps, input, options)),
    ),
    list: os.list.handler(async ({ input }) =>
      unwrapRpc(
        await listSnapshots(deps.store, live, {
          ...(input.projectId ? { projectId: input.projectId } : {}),
          ...(input.limit ? { limit: input.limit } : {}),
        }),
      ),
    ),
    get: os.get.handler(async ({ input }) =>
      snapshotOf(unwrapRpc(await deps.store.get(input.renderId)), live),
    ),
    watch: os.watch.handler(async function* ({ input, signal }) {
      yield* watchRenders(deps.store, live, input.projectId, signal ?? never, options.pollMs);
    }),
    watchBatch: os.watchBatch.handler(async function* ({ input, signal }) {
      yield* pollWatch(
        async () => unwrapRpc(await batchProgress(deps.store, live, input.batchId)),
        live,
        signal ?? never,
        options.pollMs ?? WATCH_POLL_MS,
      );
    }),
    qaReport: os.qaReport.handler(async ({ input }) => {
      const record = unwrapRpc(await deps.store.get(input.renderId));
      return unwrapRpc(
        record.qaReport
          ? ok(record.qaReport)
          : err(NotFoundError({ entity: 'qaReport', id: input.renderId })),
      );
    }),
    mediaUrl: os.mediaUrl.handler(async ({ input }) =>
      unwrapRpc(
        await renderMediaUrl(deps, previews, {
          renderId: input.renderId,
          kind: input.kind,
          ...(input.frame !== undefined ? { frame: input.frame } : {}),
        }),
      ),
    ),
    openPreview: os.openPreview.handler(async ({ input }) =>
      unwrapRpc(await previews.open(input.projectId, input.timelineId)),
    ),
    refreshPreview: os.refreshPreview.handler(async ({ input }) =>
      unwrapRpc(await previews.refresh(input.sessionId)),
    ),
    closePreview: os.closePreview.handler(async ({ input }) =>
      unwrapRpc(await previews.close(input.sessionId)),
    ),
    subtitles: os.subtitles.handler(async ({ input }) => unwrapRpc(await subtitles(deps, input))),
  });
}
