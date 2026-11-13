// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Handlers for RENDER_COMMANDS (core), registered on the agent's bus.
 * `render.export` creates the Render row and enqueues its job, and returns
 * at once; the same request while one is queued, running or ready returns
 * that render. `render.cancel` only marks the row: the job handler and the
 * render process see it and stop. Nothing here marks a render ready: an
 * override delivers through finalizeRender.
 */
import { stat } from 'node:fs/promises';
import {
  createMemorySettingsStore,
  defineCommand,
  err,
  NotImplementedError,
  NotFoundError,
  ok,
  PERSON_SOURCES,
  RENDER_COMMANDS,
  renderCommandPayloads,
  ValidationError,
  type AsyncResult,
  type CommandOutcome,
  type ProjectId,
  type QaReport,
  type RenderId,
  type RenderRecord,
} from '@taalcut/core';
import { CodecUnavailable, RenderNotReady } from '../errors';
import { hasPreset, presetCodecs, presetFor } from '../presets/presets.v1';
import { finalizeRender, overrideQa } from '../qa/finalize';
import { summarize } from '../qa/verdict';
import { exportSettingFor } from '../settings';
import { renderDestination, renderWorkFile, renderWorkSidecar } from '../store/paths';
import { FINAL_RENDER_STATUSES, RUNNING_RENDER_STATUSES } from '../store/snapshot';
import type { OverrideResult, RenderCommandDeps } from './command-deps';
import { queueExport } from './queue-export';

export type { ExportReceipt, OverrideResult, RenderCommandDeps } from './command-deps';

export function createRenderCommands(deps: RenderCommandDeps) {
  const settings = deps.settings ?? createMemorySettingsStore();
  const now = () => deps.clock.now();

  async function renderOf(projectId: ProjectId, renderId: RenderId): AsyncResult<RenderRecord> {
    const record = await deps.store.get(renderId);
    if (!record.ok) return record;
    if (record.value.projectId !== projectId) return err(NotFoundError({ entity: 'render', id: renderId }));
    return record;
  }

  const finished = (record: RenderRecord) =>
    deps.events?.emit('render.finished', {
      renderId: record.id,
      projectId: record.projectId,
      status: record.status as 'ready' | 'needsAttention' | 'failed' | 'cancelled',
      notify: record.notify,
      name: record.name,
    });

  async function deliver(record: RenderRecord, report: QaReport): AsyncResult<RenderRecord> {
    if (deps.deliver) return deps.deliver(record, report);
    const folders = deps.folders;
    if (!folders)
      return err(ValidationError({ field: 'folders' }, { detail: 'No render folders to deliver from' }));
    const sidecars = [];
    for (const format of record.request.captions.sidecars) {
      const from = renderWorkSidecar(folders, record.id, format);
      if (
        await stat(from).then(
          () => true,
          () => false,
        )
      )
        sidecars.push({ from, to: renderDestination(folders, record.projectId, record.id, format) });
    }
    return finalizeRender(
      { store: deps.store, clock: deps.clock },
      {
        renderId: record.id,
        workFile: renderWorkFile(folders, record.id),
        destination: renderDestination(folders, record.projectId, record.id),
        report,
        sidecars,
      },
    );
  }

  const exportRender = defineCommand({
    name: RENDER_COMMANDS.export,
    payload: renderCommandPayloads[RENDER_COMMANDS.export],
    sideEffect: 'write',
    handle: async (payload) => {
      const queued = await queueExport(deps, payload);
      return queued.ok ? ok({ result: queued.value }) : queued;
    },
  });

  const cancel = defineCommand({
    name: RENDER_COMMANDS.cancel,
    payload: renderCommandPayloads[RENDER_COMMANDS.cancel],
    sideEffect: 'write',
    handle: async ({ projectId, renderId }) => {
      const record = await renderOf(projectId, renderId);
      if (!record.ok) return record;
      if (FINAL_RENDER_STATUSES.has(record.value.status))
        return ok({ result: { renderId, status: record.value.status } });
      const updated = await deps.store.update(renderId, { status: 'cancelled', finishedAt: now() });
      if (!updated.ok) return updated;
      // A queued render never reaches the render process, so nobody else would announce it.
      if (record.value.status === 'queued') finished(updated.value);
      return ok({ result: { renderId, status: updated.value.status } });
    },
  });

  const setNotify = defineCommand({
    name: RENDER_COMMANDS.setNotify,
    payload: renderCommandPayloads[RENDER_COMMANDS.setNotify],
    sideEffect: 'write',
    handle: async ({ projectId, renderId, notify }) => {
      const record = await renderOf(projectId, renderId);
      if (!record.ok) return record;
      const previous = record.value.notify;
      const updated = await deps.store.update(renderId, { notify });
      if (!updated.ok) return updated;
      return ok({
        result: { renderId, notify },
        inverse: { name: RENDER_COMMANDS.setNotify, payload: { projectId, renderId, notify: previous } },
      });
    },
  });

  const setExportPreset = defineCommand({
    name: RENDER_COMMANDS.setExportPreset,
    payload: renderCommandPayloads[RENDER_COMMANDS.setExportPreset],
    sideEffect: 'write',
    handle: async ({ projectId, timelineId, presetId, codec, captions, includeBumpers }, context) => {
      // Never save a preset the engine can't render (contract review P3-1, finding 13).
      if (!hasPreset(presetId)) return err(NotImplementedError({ feature: `render.presets.${presetId}` }));
      // LNX1-AV1: a codec the preset offers; without one the codec kept only while the preset still offers it.
      const offered = presetCodecs(presetFor(presetId));
      if (codec && !offered.includes(codec))
        return err(CodecUnavailable({ codec }, { detail: `${presetId} has no ${codec}` }));
      if (timelineId) {
        const timeline = await deps.timelines.get(timelineId);
        if (!timeline.ok) return timeline;
        if (timeline.value.projectId !== projectId)
          return err(NotFoundError({ entity: 'timeline', id: timelineId }));
      }
      const setting = exportSettingFor(projectId, timelineId);
      const previous = await settings.get(setting);
      if (!previous.ok) return previous;
      const { codec: kept, ...rest } = previous.value;
      const nextCodec = codec ?? (kept && offered.includes(kept) ? kept : undefined);
      const saved = await settings.set(
        setting,
        {
          ...rest,
          presetId,
          ...(nextCodec ? { codec: nextCodec } : {}),
          captions: captions ?? previous.value.captions,
          includeBumpers: includeBumpers ?? previous.value.includeBumpers,
        },
        context,
      );
      if (!saved.ok) return saved;
      return ok({
        result: saved.value,
        inverse: {
          name: RENDER_COMMANDS.setExportPreset,
          payload: {
            projectId,
            ...(timelineId ? { timelineId } : {}),
            presetId: previous.value.presetId,
            ...(kept ? { codec: kept } : {}),
            captions: previous.value.captions,
            includeBumpers: previous.value.includeBumpers,
          },
        },
      });
    },
  });

  // P3-V7: the person's choice alone; the agent and MCP can't turn Content Credentials on.
  const setContentCredentials = defineCommand({
    name: RENDER_COMMANDS.setContentCredentials,
    payload: renderCommandPayloads[RENDER_COMMANDS.setContentCredentials],
    sideEffect: 'write',
    sources: PERSON_SOURCES,
    handle: async ({ projectId, add }, context) => {
      const setting = exportSettingFor(projectId);
      const previous = await settings.get(setting);
      if (!previous.ok) return previous;
      const saved = await settings.set(setting, { ...previous.value, contentCredentials: { add } }, context);
      if (!saved.ok) return saved;
      return ok({
        result: saved.value,
        inverse: {
          name: RENDER_COMMANDS.setContentCredentials,
          payload: { projectId, add: previous.value.contentCredentials.add },
        },
      });
    },
  });

  const override = defineCommand({
    name: RENDER_COMMANDS.overrideQa,
    payload: renderCommandPayloads[RENDER_COMMANDS.overrideQa],
    sideEffect: 'write',
    sources: PERSON_SOURCES,
    handle: async ({ projectId, renderId, checks }, context): AsyncResult<CommandOutcome<OverrideResult>> => {
      const record = await renderOf(projectId, renderId);
      if (!record.ok) return record;
      const report = record.value.qaReport;
      if (record.value.status !== 'needsAttention' || !report || record.value.deletedAt !== null)
        return err(RenderNotReady({ status: record.value.status }));
      const overridden = overrideQa(report, checks, context.actor, now());
      if (!overridden.ok) return overridden;
      const verdict: QaReport['verdict'] = overridden.value.verdict;
      if (verdict === 'overridden') {
        const delivered = await deliver(record.value, overridden.value);
        if (!delivered.ok) return delivered;
        finished(delivered.value);
        return ok({ result: { renderId, status: delivered.value.status, verdict } });
      }
      // Some failures remain: the overrides are kept and the render still needs attention.
      const updated = await deps.store.update(renderId, {
        qaReport: overridden.value,
        qa: summarize(overridden.value),
      });
      if (!updated.ok) return updated;
      return ok({ result: { renderId, status: updated.value.status, verdict } });
    },
  });

  const remove = defineCommand({
    name: RENDER_COMMANDS.delete,
    payload: renderCommandPayloads[RENDER_COMMANDS.delete],
    sideEffect: 'write',
    handle: async ({ projectId, renderId }) => {
      const record = await renderOf(projectId, renderId);
      if (!record.ok) return record;
      if (record.value.deletedAt !== null)
        return ok({ result: { renderId, deletedAt: record.value.deletedAt } });
      const at = now();
      // A render still running is cancelled first; restore brings the row back, not the run.
      const running = RUNNING_RENDER_STATUSES.has(record.value.status);
      const updated = await deps.store.update(renderId, {
        deletedAt: at,
        ...(running ? { status: 'cancelled' as const, finishedAt: at } : {}),
      });
      if (!updated.ok) return updated;
      return ok({
        result: { renderId, deletedAt: at },
        inverse: { name: RENDER_COMMANDS.restore, payload: { projectId, renderId } },
      });
    },
  });

  const restore = defineCommand({
    name: RENDER_COMMANDS.restore,
    payload: renderCommandPayloads[RENDER_COMMANDS.restore],
    sideEffect: 'write',
    internal: true,
    handle: async ({ projectId, renderId }) => {
      const record = await renderOf(projectId, renderId);
      if (!record.ok) return record;
      const updated = await deps.store.update(renderId, { deletedAt: null });
      if (!updated.ok) return updated;
      return ok({
        result: { renderId, deletedAt: null },
        inverse: { name: RENDER_COMMANDS.delete, payload: { projectId, renderId } },
      });
    },
  });

  return {
    export: exportRender,
    cancel,
    setNotify,
    setExportPreset,
    setContentCredentials,
    overrideQa: override,
    delete: remove,
    restore,
    all: [exportRender, cancel, setNotify, setExportPreset, setContentCredentials, override, remove, restore],
  };
}
