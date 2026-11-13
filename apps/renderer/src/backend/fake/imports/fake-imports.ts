// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* eslint-disable lingui/no-unlocalized-strings -- synthetic filenames and source labels are fixture data */
import {
  IMPORT_METHODS,
  appContract,
  defineCommand,
  err,
  ValidationError,
  implementContract,
  importCommandPayloads,
  IMPORT_COMMANDS,
  newId,
  NotFoundError,
  ok,
  toRpcError,
  importDraftSchema,
  importSessionSchema,
  importItemSchema,
  importItemOutcomeSchema,
  type ImportDraftId,
  type ImportDraft,
  type ImportItem,
  type ImportItemOutcome,
  type ImportSession,
  type AnyCommand,
} from '@taalcut/core';
import { z } from 'zod';
import { watched } from '../watch';

interface DraftRecord {
  draft: ImportDraft;
  items: ImportItem[];
}
interface SessionRecord {
  session: ImportSession;
  items: ImportItemOutcome[];
}
const missing = (id: string) => toRpcError(NotFoundError({ entity: 'import', id }));
const chosen = (draft: ImportDraft, item: ImportItem) =>
  (!draft.onlyNew || !item.duplicate) &&
  (draft.selectAll ? !draft.excludedIds.includes(item.id) : draft.selectedIds.includes(item.id));
const page = <T>(items: T[], cursor?: string, limit = 100) => {
  const offset = Number(cursor ?? 0);
  return {
    items: items.slice(offset, offset + limit),
    ...(offset + limit < items.length ? { nextCursor: String(offset + limit) } : {}),
  };
};

/** A browser fixture of the same durable command flow; no native permission or filesystem access. */
export function createFakeImports(pickedFolder?: string | null) {
  const drafts = new Map<string, DraftRecord>();
  const sessions = new Map<string, SessionRecord>();
  const savedSchema = z.object({
    drafts: z.array(z.object({ draft: importDraftSchema, items: z.array(importItemSchema) })),
    sessions: z.array(z.object({ session: importSessionSchema, items: z.array(importItemOutcomeSchema) })),
  });
  const key = 'taalcut.fake.imports';
  try {
    const saved = savedSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? 'null'));
    if (saved.success) {
      for (const record of saved.data.drafts) drafts.set(record.draft.id, record);
      for (const record of saved.data.sessions) sessions.set(record.session.id, record);
    }
  } catch {
    /* Preview storage is optional; the real backend persists in SQLite. */
  }
  const persist = () => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ drafts: [...drafts.values()], sessions: [...sessions.values()] }),
      );
    } catch {
      /* A browser fixture must still work with storage disabled. */
    }
  };
  const changes = watched(() => ({ sessions: [...sessions.values()].map((record) => record.session) }));
  const os = implementContract(appContract.imports);
  const draft = (id: string) => {
    const record = drafts.get(id);
    if (!record) throw missing(id);
    return record;
  };
  const session = (id: string) => {
    const record = sessions.get(id);
    if (!record) throw missing(id);
    return record;
  };
  const preflight = (id: string) => {
    const record = draft(id);
    const items = record.items.filter((item) => chosen(record.draft, item));
    return {
      draftId: record.draft.id,
      selectedItems: items.length,
      selectedCaptures: items.length,
      knownBytes: items.reduce((total, item) => total + (item.sizeBytes ?? 0), 0),
      unknownSizeItems: items.filter((item) => item.sizeBytes === null).length,
      availableBytes: 100_000_000_000,
      destinationLabel: record.draft.destinationLabel,
      storage: record.draft.storage,
      duplicateItems: items.filter((item) => item.duplicate).length,
      unsupportedItems: items.filter((item) => !item.supported).length,
      missingRequired: [],
      warnings: [],
      canStart: items.length > 0,
    };
  };
  const commands: AnyCommand[] = [
    defineCommand({
      name: IMPORT_COMMANDS.createDraft,
      payload: importCommandPayloads[IMPORT_COMMANDS.createDraft],
      sideEffect: 'write',
      project: () => null,
      handle: async (input) => {
        if (pickedFolder === '' && (input.method === 'files' || input.method === 'folder'))
          return err(ValidationError({ field: 'path' }));
        if (pickedFolder === null && (input.method === 'files' || input.method === 'folder'))
          return ok({ result: { draftId: null as ImportDraftId | null } });
        const id = newId<'ImportDraft'>();
        const count = input.method === 'files' ? 3 : 240;
        const items: ImportItem[] = Array.from({ length: count }, (_, index) => ({
          id: newId(),
          name: `DSC_${String(index + 1).padStart(4, '0')}.${input.method === 'insta360' && index % 3 === 0 ? 'insv' : 'mp4'}`,
          sizeBytes: input.method === 'photos' && index % 5 === 0 ? null : 24_000_000 + index * 1_000_000,
          capturedAt: Date.UTC(2026, 9, 25 - Math.floor(index / 20), 12, index % 20),
          thumbnailUrl: null,
          duplicate: index > 0 && index % 8 === 0,
          captureId: null,
          required: true,
          supported: !(input.method === 'insta360' && index % 3 === 0),
          warning: null,
        }));
        drafts.set(id, {
          draft: {
            id,
            method: input.method,
            sourceLabel: 'Weekend footage',
            sourceId: null,
            selectedIds: [],
            selectAll: input.method === 'files' || input.watch,
            excludedIds: [],
            onlyNew: true,
            storage: input.watch ? 'reference' : 'copy',
            destinationLabel: 'Taalcut Library',
            allowNetwork: false,
            watch: input.watch,
            recursive: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            sessionId: null,
          },
          items,
        });
        persist();
        return ok({ result: { draftId: id } });
      },
    }),
    defineCommand({
      name: IMPORT_COMMANDS.updateDraft,
      payload: importCommandPayloads[IMPORT_COMMANDS.updateDraft],
      sideEffect: 'write',
      project: () => null,
      handle: async ({ draftId, ...patch }) => {
        const record = draft(draftId);
        record.draft = { ...record.draft, ...patch, updatedAt: Date.now() };
        persist();
        return ok({ result: { draftId } });
      },
    }),
    defineCommand({
      name: IMPORT_COMMANDS.discardDraft,
      payload: importCommandPayloads[IMPORT_COMMANDS.discardDraft],
      sideEffect: 'write',
      project: () => null,
      handle: async ({ draftId }) => {
        drafts.delete(draftId);
        persist();
        return ok({ result: { draftId } });
      },
    }),
    defineCommand({
      name: IMPORT_COMMANDS.start,
      payload: importCommandPayloads[IMPORT_COMMANDS.start],
      sideEffect: 'write',
      project: () => null,
      handle: async ({ draftId }) => {
        const record = draft(draftId);
        if (record.draft.sessionId) return ok({ result: { sessionId: record.draft.sessionId } });
        const id = newId<'ImportSession'>();
        const selected = record.items.filter((item) => chosen(record.draft, item));
        const items: ImportItemOutcome[] = selected.map((item) => ({
          itemId: item.id,
          name: item.name,
          state: item.duplicate ? 'duplicate' : item.supported ? 'imported' : 'archived',
          receivedBytes: item.sizeBytes ?? 0,
          result: item.supported
            ? null
            : { kind: 'archived', captureId: newId<'CaptureGroup'>(), complete: true },
          error: null,
        }));
        sessions.set(id, {
          items,
          session: {
            id,
            draftId,
            method: record.draft.method,
            sourceLabel: record.draft.sourceLabel,
            sourceId: null,
            status: 'completed',
            stage: 'available',
            progress: {
              totalItems: items.length,
              completedItems: items.filter((item) => item.state === 'imported').length,
              failedItems: 0,
              skippedItems: items.filter((item) => item.state === 'duplicate').length,
              archivedItems: items.filter((item) => item.state === 'archived').length,
              receivedBytes: items.reduce((total, item) => total + item.receivedBytes, 0),
              totalBytes: preflight(draftId).knownBytes,
              bytesPerSecond: null,
              etaSeconds: null,
              currentFile: null,
            },
            capabilities: {
              pause: false,
              resume: false,
              cancel: false,
              retryFailed: false,
              byteResume: false,
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
            finishedAt: Date.now(),
            safeToDisconnect: true,
          },
        });
        record.draft = { ...record.draft, sessionId: id };
        persist();
        changes.notify();
        return ok({ result: { sessionId: id } });
      },
    }),
    defineCommand({
      name: IMPORT_COMMANDS.ejectSource,
      payload: importCommandPayloads[IMPORT_COMMANDS.ejectSource],
      sideEffect: 'write',
      project: () => null,
      handle: async ({ sourceId }) => ok({ result: { sourceId } }),
    }),
    ...(['pause', 'resume', 'cancel', 'retryFailed'] as const).map((action) =>
      defineCommand({
        name: IMPORT_COMMANDS[action],
        payload: importCommandPayloads[IMPORT_COMMANDS[action]],
        sideEffect: 'write',
        project: () => null,
        handle: async ({ sessionId }) => {
          const record = session(sessionId);
          record.session = {
            ...record.session,
            status: action === 'pause' ? 'paused' : action === 'cancel' ? 'cancelled' : 'running',
            updatedAt: Date.now(),
          };
          persist();
          changes.notify();
          return ok({ result: { sessionId } });
        },
      }),
    ),
  ];
  return {
    commands,
    router: {
      imports: os.router({
        sources: os.sources.handler(({ input }) =>
          IMPORT_METHODS.filter((method) => !input.method || method === input.method).map((method) => ({
            id: method,
            method,
            label:
              method === 'photos'
                ? 'System Photo Library'
                : method === 'phone-wifi'
                  ? 'Local network'
                  : 'Macintosh HD',
            available: ['files', 'folder', 'phone-wifi', 'photos'].includes(method),
            status: null,
          })),
        ),
        drafts: os.drafts.handler(() =>
          [...drafts.values()].map((record) => record.draft).filter((value) => !value.sessionId),
        ),
        draft: os.draft.handler(({ input }) => drafts.get(input.draftId)?.draft ?? null),
        items: os.items.handler(({ input }) => {
          const items = draft(input.draftId).items.filter(
            (item) =>
              (!input.onlyNew || !item.duplicate) &&
              (!input.query || item.name.toLocaleLowerCase().includes(input.query.toLocaleLowerCase())),
          );
          return { ...page(items, input.cursor, input.limit), total: items.length };
        }),
        preflight: os.preflight.handler(({ input }) => preflight(input.draftId)),
        history: os.history.handler(({ input }) =>
          page(
            [...sessions.values()]
              .map((value) => value.session)
              .filter((value) => !input.methods || input.methods.includes(value.method))
              .reverse(),
            input.cursor,
            input.limit,
          ),
        ),
        session: os.session.handler(({ input }) => {
          const record = sessions.get(input.sessionId);
          return record
            ? { session: record.session, ...page(record.items, input.cursor, input.limit) }
            : null;
        }),
        watch: os.watch.handler(({ input, signal }) =>
          (async function* () {
            for await (const value of changes.stream(signal))
              yield {
                sessions: value.sessions.filter((entry) => !input.sessionId || entry.id === input.sessionId),
              };
          })(),
        ),
      }),
    },
  };
}
