// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  NotFoundError,
  NotImplementedError,
  ValidationError,
  err,
  newId,
  ok,
  toTaalcutError,
  type AsyncResult,
  type ImportDraft,
  type ImportDraftId,
  type ImportMethod,
  type ImportPreflight,
  type ImportSession,
  type ImportSessionId,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { ImportAdapter, ImportCreateInput, ImportUpdateInput } from './adapter';
import { createImportFeed } from './feed';
import { createImportProjections, projectImportMilestones } from './projections';
import { createImportRunner } from './runner';
import { finishedImportItem, importPage, selectedImportItems } from './selection';
import { createImportStore } from './store';

export interface ImportSessionServiceOptions {
  readonly db: LibraryDatabase;
  readonly adapters: Partial<Record<ImportMethod, ImportAdapter>>;
  readonly now?: () => number;
  readonly ejectSource?: (sourceId: string) => AsyncResult<void>;
}
const missing = (entity: string, id: string) => err(NotFoundError({ entity, id }));
const conflict = (id: string) => err(ConflictError({ entity: 'import', id }));

/** Durable state is independent of renderer subscriptions. Restart offers recovery without resuming reads. */
export function createImportSessionService(options: ImportSessionServiceOptions) {
  const store = createImportStore(options.db);
  const now = options.now ?? options.db.clock;
  let closed = false;
  const commands = new Map<string, Promise<unknown>>();
  async function serial<T>(key: string, execute: () => AsyncResult<T>): AsyncResult<T> {
    const operation = (commands.get(key) ?? Promise.resolve())
      .then(execute)
      .catch((cause: unknown) => err(toTaalcutError(cause)));
    commands.set(key, operation);
    try {
      return await operation;
    } finally {
      if (commands.get(key) === operation) commands.delete(key);
    }
  }
  const project = (session: ImportSession) => {
    const projected = projectImportMilestones(options.db, store, session);
    const saved = session.draftId ? store.draft(session.draftId) : null;
    const adapter = options.adapters[session.method];
    return saved && adapter?.safeToDisconnect
      ? {
          ...projected,
          safeToDisconnect:
            projected.safeToDisconnect && adapter.safeToDisconnect(saved.draft, saved.privateData),
        }
      : projected;
  };
  const sessions = () => store.sessions().map(project);
  const feed = createImportFeed(sessions);
  const projections = createImportProjections(options.db, store, feed.changed);
  projections.backfill();
  const runner = createImportRunner(store, feed.changed, now);
  for (const session of store.sessions())
    if (session.status === 'running')
      store.saveSession({
        ...session,
        status: 'interrupted',
        safeToDisconnect: false,
        progress: { ...session.progress, bytesPerSecond: null, etaSeconds: null },
      });

  const unavailable = () => err(NotImplementedError({ feature: 'import method' }));
  async function createDraft(input: ImportCreateInput): AsyncResult<{ draftId: ImportDraftId }> {
    const adapter = options.adapters[input.method];
    if (!adapter) return unavailable();
    try {
      const prepared = await adapter.prepare(input);
      if (!prepared.ok) return prepared;
      const value = prepared.value;
      const id = newId<'ImportDraft'>();
      const draft: ImportDraft = {
        id,
        method: input.method,
        sourceLabel: value.sourceLabel,
        sourceId: value.sourceId ?? null,
        storage: input.watch ? 'reference' : 'copy',
        destinationLabel: value.destinationLabel,
        selectedIds: [],
        selectAll: value.selectAll ?? input.method === 'files',
        excludedIds: [],
        onlyNew: false,
        allowNetwork: false,
        watch: input.watch,
        recursive: true,
        createdAt: now(),
        updatedAt: now(),
        sessionId: null,
      };
      store.insertDraft(draft, value.items, value.privateData, value.captures);
      return ok({ draftId: id });
    } catch (cause) {
      return err(toTaalcutError(cause));
    }
  }
  async function updateDraft(input: ImportUpdateInput): AsyncResult<{ draftId: ImportDraftId }> {
    const saved = store.draft(input.draftId);
    if (!saved) return missing('importDraft', input.draftId);
    if (saved.draft.sessionId) return conflict(input.draftId);
    const known = new Set(store.prepared(input.draftId).map((entry) => entry.item.id));
    if ([...(input.selectedIds ?? []), ...(input.excludedIds ?? [])].some((id) => !known.has(id)))
      return err(ValidationError({ field: 'selectedIds' }));
    if (input.storage === 'reference' && !['files', 'folder'].includes(saved.draft.method))
      return err(ValidationError({ field: 'storage' }));
    const { draftId, ...patch } = input;
    store.saveDraft({ ...saved.draft, ...patch, updatedAt: now() });
    return ok({ draftId });
  }
  async function preflight(
    draftId: ImportDraftId,
    retrySessionId?: ImportSessionId,
    starting = false,
  ): AsyncResult<ImportPreflight> {
    const saved = store.draft(draftId);
    if (!saved) return missing('importDraft', draftId);
    const { draft, privateData } = saved;
    const adapter = options.adapters[draft.method];
    if (!adapter) return unavailable();
    const finished = new Set(
      retrySessionId
        ? store
            .outcomes(retrySessionId)
            .filter(finishedImportItem)
            .map((item) => item.itemId)
        : [],
    );
    const items = selectedImportItems(draft, store.prepared(draftId))
      .filter((entry) => adapter.includes?.(draft, entry, privateData) ?? true)
      .filter((entry) => !finished.has(entry.item.id));
    const captureIds = new Set(items.map((entry) => entry.item.captureId));
    const captures = saved.captures.filter((capture) => captureIds.has(capture.id));
    const checked = await adapter.preflight?.(draft, items, privateData, { starting });
    if (checked && !checked.ok) return checked;
    const unknown = items.filter((entry) => entry.item.sizeBytes === null).length;
    const unsupported = items.filter((entry) => !entry.item.supported).length;
    const base: ImportPreflight = {
      draftId,
      selectedItems: items.length,
      selectedCaptures: new Set(items.map((entry) => entry.item.captureId ?? entry.item.id)).size,
      knownBytes: items.reduce((sum, entry) => sum + (entry.item.sizeBytes ?? 0), 0),
      unknownSizeItems: unknown,
      availableBytes: null,
      destinationLabel: draft.destinationLabel,
      storage: draft.storage,
      duplicateItems: items.filter((entry) => entry.item.duplicate).length,
      unsupportedItems: unsupported,
      missingRequired: captures.flatMap((capture) => capture.missingRequired),
      warnings: captures.flatMap((capture) => capture.warnings),
      canStart: items.length > 0 && unsupported === 0,
    };
    const merged = { ...base, ...(checked?.ok ? checked.value : {}) };
    return ok({
      ...merged,
      canStart:
        merged.canStart &&
        (draft.storage !== 'copy' ||
          merged.availableBytes === null ||
          merged.availableBytes >= merged.knownBytes),
    });
  }
  async function startOnce(draftId: ImportDraftId): AsyncResult<{ sessionId: ImportSessionId }> {
    if (closed) return conflict(draftId);
    const saved = store.draft(draftId);
    if (!saved) return missing('importDraft', draftId);
    if (saved.draft.sessionId) return ok({ sessionId: saved.draft.sessionId });
    const ready = await preflight(draftId, undefined, true);
    if (closed) return conflict(draftId);
    if (!ready.ok) return ready;
    if (!ready.value.canStart) return err(ValidationError({ field: 'importPreflight' }));
    const fresh = store.draft(draftId);
    if (!fresh) return missing('importDraft', draftId);
    if (fresh.draft.sessionId) return ok({ sessionId: fresh.draft.sessionId });
    if (JSON.stringify(fresh.draft) !== JSON.stringify(saved.draft)) return conflict(draftId);
    const adapter = options.adapters[fresh.draft.method];
    if (!adapter) return unavailable();
    const id = newId<'ImportSession'>();
    const items = selectedImportItems(fresh.draft, store.prepared(draftId)).filter(
      (entry) => adapter.includes?.(fresh.draft, entry, fresh.privateData) ?? true,
    );
    const session: ImportSession = {
      id,
      draftId,
      method: fresh.draft.method,
      sourceLabel: fresh.draft.sourceLabel,
      sourceId: fresh.draft.sourceId,
      status: 'running',
      stage: 'receiving',
      capabilities: adapter.capabilities,
      createdAt: now(),
      updatedAt: now(),
      finishedAt: null,
      safeToDisconnect: false,
      progress: {
        totalItems: items.length,
        completedItems: 0,
        failedItems: 0,
        skippedItems: 0,
        archivedItems: 0,
        receivedBytes: 0,
        totalBytes:
          fresh.draft.storage === 'reference' || ready.value.unknownSizeItems > 0
            ? null
            : ready.value.knownBytes,
        bytesPerSecond: null,
        etaSeconds: null,
        currentFile: null,
      },
    };
    store.transaction(() => {
      store.saveSession(session);
      store.saveDraft({ ...fresh.draft, sessionId: id, updatedAt: now() });
      items.forEach((entry, index) =>
        store.putOutcome(
          id,
          {
            itemId: entry.item.id,
            name: entry.item.name,
            state: 'pending',
            receivedBytes: 0,
            result: null,
            error: null,
          },
          index,
        ),
      );
    });
    feed.changed(true);
    runner.launch(session, fresh.draft, items, fresh.privateData, adapter);
    return ok({ sessionId: id });
  }
  async function controlOnce(
    sessionId: ImportSessionId,
    action: 'pause' | 'resume' | 'cancel' | 'retryFailed',
  ): AsyncResult<{ sessionId: ImportSessionId }> {
    if (closed) return conflict(sessionId);
    const session = store.session(sessionId);
    if (!session) return missing('importSession', sessionId);
    if (!session.capabilities[action]) return conflict(sessionId);
    if (action === 'pause' || action === 'cancel') {
      if (session.status === 'completed' || session.status === 'cancelled') return conflict(sessionId);
      store.saveSession({
        ...session,
        status: action === 'pause' ? 'paused' : 'cancelled',
        safeToDisconnect: false,
        updatedAt: now(),
      });
      await runner.stop(sessionId, action);
      feed.changed(true);
      return ok({ sessionId });
    }
    if (session.status === 'running') return ok({ sessionId });
    if (action === 'resume' && !['paused', 'interrupted'].includes(session.status))
      return conflict(sessionId);
    if (!session.draftId) return conflict(sessionId);
    const saved = store.draft(session.draftId);
    if (!saved) return missing('importDraft', session.draftId);
    const adapter = options.adapters[session.method];
    if (!adapter) return unavailable();
    const ready = await preflight(session.draftId, sessionId, true);
    if (closed) return conflict(sessionId);
    if (!ready.ok) return ready;
    if (!ready.value.canStart) return err(ValidationError({ field: 'importPreflight' }));
    const complete = new Set(
      store
        .outcomes(sessionId)
        .filter(finishedImportItem)
        .map((item) => item.itemId),
    );
    const items = selectedImportItems(saved.draft, store.prepared(session.draftId))
      .filter((entry) => adapter.includes?.(saved.draft, entry, saved.privateData) ?? true)
      .filter((entry) => !complete.has(entry.item.id));
    const next = {
      ...session,
      status: 'running' as const,
      safeToDisconnect: false,
      updatedAt: now(),
      finishedAt: null,
    };
    store.saveSession(next);
    feed.changed(true);
    runner.launch(next, saved.draft, items, saved.privateData, adapter);
    return ok({ sessionId });
  }
  return {
    async ejectSource(sourceId: string) {
      if (!options.ejectSource) return unavailable();
      const result = await options.ejectSource(sourceId);
      return result.ok ? ok({ sourceId }) : result;
    },
    projectTransferSession: projections.projectTransferSession,
    projectTransferFile: projections.projectTransferFile,
    refresh: () => feed.changed(true),
    createDraft,
    updateDraft,
    preflight,
    start: (id: ImportDraftId) => serial(`draft:${id}`, () => startOnce(id)),
    draft: (id: ImportDraftId) => store.draft(id)?.draft ?? null,
    drafts: store.drafts,
    items(input: {
      draftId: ImportDraftId;
      cursor?: string;
      limit?: number;
      query?: string;
      onlyNew?: boolean;
    }) {
      const query = input.query?.toLocaleLowerCase();
      const items = store
        .prepared(input.draftId)
        .map((entry) => entry.item)
        .filter(
          (item) =>
            (!query || item.name.toLocaleLowerCase().includes(query)) && (!input.onlyNew || !item.duplicate),
        );
      return { ...importPage(items, input.cursor, input.limit), total: items.length };
    },
    history(input: { cursor?: string; limit?: number; methods?: ImportMethod[] } = {}) {
      return importPage(
        sessions().filter((session) => !input.methods || input.methods.includes(session.method)),
        input.cursor,
        input.limit,
      );
    },
    session(input: { sessionId: ImportSessionId; cursor?: string; limit?: number }) {
      const saved = store.session(input.sessionId);
      const session = saved ? project(saved) : null;
      return session
        ? { session, ...importPage(store.outcomes(input.sessionId), input.cursor, input.limit) }
        : null;
    },
    watch: (input: { sessionId?: ImportSessionId }, signal: AbortSignal) =>
      feed.watch(input.sessionId, signal),
    async discardDraft(id: ImportDraftId) {
      const saved = store.draft(id);
      if (!saved) return missing('importDraft', id);
      if (saved.draft.sessionId) return conflict(id);
      store.discard(id);
      return ok({ draftId: id });
    },
    pause: (id: ImportSessionId) => serial(id, () => controlOnce(id, 'pause')),
    resume: (id: ImportSessionId) => serial(id, () => controlOnce(id, 'resume')),
    cancel: (id: ImportSessionId) => serial(id, () => controlOnce(id, 'cancel')),
    retryFailed: (id: ImportSessionId) => serial(id, () => controlOnce(id, 'retryFailed')),
    async close() {
      closed = true;
      for (const session of store.sessions())
        if (session.status === 'running')
          store.saveSession({ ...session, status: 'interrupted', safeToDisconnect: false });
      await runner.close();
      await Promise.all([...commands.values()]);
      await Promise.all([...new Set(Object.values(options.adapters))].map((adapter) => adapter?.close?.()));
      feed.close();
    },
  };
}
export type ImportSessionService = ReturnType<typeof createImportSessionService>;
