// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import {
  agentTurnGroup,
  CancelledError,
  CommandBusToken,
  defineToolModule,
  err,
  ExperimentSandboxToken,
  idSchema,
  IMPORT_COMMANDS,
  JobRunnerToken,
  newId,
  ok,
  ValidationError,
  type AsyncResult,
  type CommandToolContext,
  type Container,
  type ExperimentId,
  type ToolModule,
} from '@taalcut/core';
import { parseSourceVideoLink, sourceFetchJob, sourceFetchJobOutputSchema } from '@taalcut/templates';
import { createShortsCache } from '@taalcut/library';
import { createShortsImportTool, type ShortImportInput, type ShortImportOutput } from '@taalcut/shorts';
import { z } from 'zod';
import { LibraryDatabaseToken } from '../../shared/tokens';
import { awaitShortsImport, awaitShortsSourceReady, isShortsImportCancelled } from './shorts-import-wait';

const receiptSchema = z.object({
  experimentId: idSchema<'Experiment'>().optional(),
  fetched: sourceFetchJobOutputSchema.optional(),
  draftId: idSchema<'ImportDraft'>().optional(),
  sessionId: idSchema<'ImportSession'>().optional(),
  assetId: idSchema<'Asset'>().optional(),
  retry: z.int().nonnegative().optional(),
});
type Receipt = z.output<typeof receiptSchema>;
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Merge these tools into the editorial `shorts` module; no second registry module with the same id. */
export function shortsImportToolModule(
  container: Container,
  options: { localOnly?: boolean } = {},
): ToolModule {
  const tool = createShortsImportTool({ localOnly: options.localOnly, run: importSource });

  async function importSource(
    input: ShortImportInput,
    ctx: CommandToolContext,
  ): AsyncResult<ShortImportOutput> {
    const sandbox = container.resolve(ExperimentSandboxToken);
    const db = container.resolve(LibraryDatabaseToken);
    const cache = createShortsCache(db);
    let path = input.path;
    let sourceUrl: string | undefined;
    let fileIdentity: unknown;
    if (input.url) {
      if (options.localOnly)
        return err(
          ValidationError({ field: 'url' }, { detail: 'Source downloads are disabled in local-only mode' }),
        );
      const parsed = parseSourceVideoLink(input.url);
      if (!parsed.ok) return parsed;
      sourceUrl = parsed.value.url;
    } else {
      if (!path || !isAbsolute(path)) return err(ValidationError({ field: 'path' }));
      const info = await stat(path).catch(() => null);
      if (!info?.isFile())
        return err(ValidationError({ field: 'path' }, { detail: 'Source file is unavailable' }));
      fileIdentity = { size: info.size, modified: info.mtimeMs };
    }
    const key = `shorts.import:${fingerprint({ projectId: input.projectId, path, sourceUrl, fileIdentity })}`;
    const cached = await cache.get(key);
    if (!cached.ok) return cached;
    if (ctx.signal.aborted) return err(CancelledError());
    const parsed = receiptSchema.safeParse(cached.value);
    let receipt: Receipt = parsed.success ? parsed.data : {};
    const save = async (patch: Partial<Receipt>) => {
      receipt = { ...receipt, ...patch };
      return cache.put(key, receipt);
    };
    const retire = () => save({ draftId: undefined, sessionId: undefined, retry: (receipt.retry ?? 0) + 1 });
    if (!receipt.assetId && receipt.sessionId && isShortsImportCancelled(db, receipt.sessionId)) {
      const retired = await retire();
      if (!retired.ok) return retired;
    }
    const bus = container.resolve(CommandBusToken);
    const origin = { source: 'agent' as const, actor: `agent:${ctx.runId ?? ctx.callId}` };
    const dispatch = (name: string, payload: unknown, suffix: string) =>
      bus.dispatch(name, payload, origin, {
        idempotencyKey: `${key}:${suffix}`,
        ...(ctx.runId ? { group: agentTurnGroup(ctx.runId) } : {}),
      });

    if (sourceUrl && !receipt.assetId && !receipt.sessionId) {
      let experiment = receipt.experimentId ? await sandbox.get(receipt.experimentId) : null;
      if (!experiment?.ok) {
        const id = newId<'Experiment'>();
        experiment = await sandbox.open({
          id,
          projectId: input.projectId,
          purpose: 'analysis',
          ttlMs: 48 * 60 * 60_000,
        });
        if (!experiment.ok) return experiment;
        const saved = await save({ experimentId: id, fetched: undefined, draftId: undefined });
        if (!saved.ok) return saved;
      }
      if (!receipt.fetched) {
        ctx.reportProgress(0.05, 'Downloading the source video');
        const fetched = await container.resolve(JobRunnerToken).run(
          sourceFetchJob,
          { experimentId: experiment.value.id, url: sourceUrl },
          {
            signal: ctx.signal,
            projectId: input.projectId,
            onProgress: (progress) => ctx.reportProgress((progress.fraction ?? 0) * 0.4),
          },
        );
        if (!fetched.ok) return fetched;
        const saved = await save({ fetched: fetched.value });
        if (!saved.ok) return saved;
      }
      path = join(experiment.value.dir, receipt.fetched!.file);
      const inside = relative(experiment.value.dir, path);
      if (!inside || inside.startsWith('..') || isAbsolute(inside))
        return err(ValidationError({ field: 'source.file' }));
    }
    if (!receipt.sessionId && !receipt.assetId) {
      if (ctx.signal.aborted) return err(CancelledError());
      if (!receipt.draftId) {
        const payload = { method: 'files', paths: [path], watch: false };
        // The tool context's original command key would replay the terminal draft after cancellation.
        const created = receipt.retry
          ? await dispatch(IMPORT_COMMANDS.createDraft, payload, `create:${receipt.retry}`).then((result) =>
              result.ok ? ok(result.value.result) : result,
            )
          : await ctx.dispatch(payload);
        if (!created.ok) return created;
        const draft = z.object({ draftId: idSchema<'ImportDraft'>() }).safeParse(created.value);
        if (!draft.success) return err(ValidationError({ field: 'importDraft' }));
        const saved = await save(draft.data);
        if (!saved.ok) return saved;
      }
      const configured = await dispatch(
        IMPORT_COMMANDS.updateDraft,
        { draftId: receipt.draftId, storage: 'copy', selectAll: true, onlyNew: false },
        `copy:${receipt.draftId}`,
      );
      if (!configured.ok) return configured;
      const started = await dispatch(
        IMPORT_COMMANDS.start,
        { draftId: receipt.draftId },
        `start:${receipt.draftId}`,
      );
      if (!started.ok) return started;
      const session = z.object({ sessionId: idSchema<'ImportSession'>() }).safeParse(started.value.result);
      if (!session.success) return err(ValidationError({ field: 'importSession' }));
      const saved = await save(session.data);
      if (!saved.ok) return saved;
    }
    if (!receipt.assetId) {
      ctx.reportProgress(0.45, 'Keeping the source in the library');
      const imported = await awaitShortsImport(db, receipt.sessionId!, ctx.signal);
      if (!imported.ok) {
        if (CancelledError.is(imported.error)) {
          const cancelled = await dispatch(
            IMPORT_COMMANDS.cancel,
            { sessionId: receipt.sessionId },
            `cancel:${receipt.sessionId}`,
          );
          if (cancelled.ok) {
            const retired = await retire();
            if (!retired.ok) return retired;
          }
        }
        return imported;
      }
      const saved = await save({ assetId: imported.value });
      if (!saved.ok) return saved;
    }
    if (sourceUrl || receipt.fetched?.metadata) {
      const saved = await cache.put(`shorts.sourceMetadata:${receipt.assetId}`, {
        ...receipt.fetched?.metadata,
        ...(sourceUrl ? { sourceUrl } : {}),
      });
      if (!saved.ok) return saved;
    }
    if (receipt.experimentId) {
      // The managed import has finished copying. A failed discard is left for the normal experiment sweep.
      await sandbox.discard(receipt.experimentId as ExperimentId);
    }
    ctx.reportProgress(0.6, 'Analysing the complete source');
    const ready = await awaitShortsSourceReady(db, receipt.assetId!, ctx.signal);
    if (!ready.ok) return ready;
    ctx.reportProgress(1);
    return ok({
      assetId: receipt.assetId!,
      sessionId: receipt.sessionId!,
      ...(sourceUrl ? { sourceUrl } : {}),
    });
  }
  return defineToolModule({ id: 'shorts', tools: [tool] });
}
