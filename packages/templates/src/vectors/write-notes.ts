// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The one place every template write passes through (LRN1-TPL): a decorator over the TemplateStore that the
 * composition root binds (apps/desktop's library-agent root). Every write path goes through the store: create
 * (finalise, a format plan, a starter, a hub fork, an import, Instagram's auto-breakdown), a new version (slot edits,
 * the energy curve), a head move (undo, redo), metadata (name, tags) and delete.
 *
 * Each successful write is noted as `library.changed` (entity 'template') under its command and sent only once the
 * command commits (core's commit announcer), so nothing reacts to a version a failed command threw away. A write
 * with no command (start-up, tests) is sent at once. The template index follows these events (vectors/follow.ts);
 * the renderer's template lists may too.
 */
import {
  createCommitAnnouncer,
  type CommandBus,
  type CommandContext,
  type EventBus,
  type Result,
  type TemplateId,
  type TemplateStore,
} from '@taalcut/core';

export type TemplateWriteKind = 'created' | 'updated' | 'deleted';

export interface TemplateWriteNotes {
  /** A template changed; sent once `context`'s command commits, or now without one. */
  note(templateId: TemplateId, change: TemplateWriteKind, context?: CommandContext): void;
  /** Sends committed notes: call once with the bus the template commands run on. Returns the unsubscribe. */
  attach(bus: Pick<CommandBus, 'subscribe'>): () => void;
}

export function createTemplateWriteNotes(events: Pick<EventBus, 'emit'>): TemplateWriteNotes {
  const announcer = createCommitAnnouncer();
  return {
    note(templateId, change, context) {
      const payload = { entity: 'template' as const, change, ids: [templateId] };
      if (context) announcer.note(context, { ...payload, projectId: context.projectId });
      else events.emit('library.changed', { ...payload, projectId: null });
    },
    attach: (bus) => announcer.attach(bus, events),
  };
}

/** The store with every successful write noted; reads pass through untouched. */
export function notedTemplateStore(store: TemplateStore, notes: TemplateWriteNotes): TemplateStore {
  /** The write's own result, noted for `templateId` when it went through. */
  const noted = <T>(
    written: Result<T>,
    templateId: (value: T) => TemplateId,
    change: TemplateWriteKind,
    context: CommandContext | undefined,
  ): Result<T> => {
    if (written.ok) notes.note(templateId(written.value), change, context);
    return written;
  };
  return {
    create: async (template, meta, context) =>
      noted(await store.create(template, meta, context), (made) => made.id, 'created', context),
    addVersion: async (template, change, context) =>
      noted(await store.addVersion(template, change, context), (added) => added.id, 'updated', context),
    setHead: async (input, context) =>
      noted(await store.setHead(input, context), (moved) => moved.id, 'updated', context),
    setMeta: async (templateId, patch, context) =>
      noted(await store.setMeta(templateId, patch, context), () => templateId, 'updated', context),
    remove: async (templateId, context) =>
      noted(await store.remove(templateId, context), () => templateId, 'deleted', context),
    get: (templateId, version) => store.get(templateId, version),
    findChild: (templateId, parentVersion, changeKey) =>
      store.findChild(templateId, parentVersion, changeKey),
    latestVersion: (templateId) => store.latestVersion(templateId),
    versions: (templateId) => store.versions(templateId),
    list: (query) => store.list(query),
    usedBy: (templateId) => store.usedBy(templateId),
    putAsset: (bytes, mediaType) => store.putAsset(bytes, mediaType),
    assetPath: (sha256) => store.assetPath(sha256),
  };
}
