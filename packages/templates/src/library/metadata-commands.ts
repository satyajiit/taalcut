// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Library metadata commands (P3-V14). They change the lineage, not a version, and are app-wide.
 * `moveToFolder` is one undo: `template.restoreFolders` puts every template back. On a store that doesn't keep
 * the library metadata (`libraryMetadata: false`) every one is core.not_implemented: its whole effect would be
 * dropped.
 */
import {
  defineCommand,
  err,
  ok,
  TEMPLATE_COMMANDS,
  templateCommandPayloads,
  type AnyCommand,
  type TemplateFolderStore,
  type TemplateId,
  type TemplateStore,
} from '@taalcut/core';
import { FolderNotFound } from '../errors';
import { storedSummary } from '../store/stored-summary';
import { libraryNotServed } from './library-metadata';
import { normaliseTag } from './tags';

const N = TEMPLATE_COMMANDS;
const P = templateCommandPayloads;

export function createMetadataCommands(deps: {
  readonly store: TemplateStore;
  readonly folders: TemplateFolderStore;
  /** The store keeps tags, folders, favourites and trend dates (library-metadata.ts). */
  readonly libraryMetadata: boolean;
}) {
  const { store, folders, libraryMetadata } = deps;

  const setTags = defineCommand({
    name: N.setTags,
    payload: P[N.setTags],
    sideEffect: 'write',
    handle: async ({ templateId, tags }, context) => {
      if (!libraryMetadata) return libraryNotServed();
      const before = await storedSummary(store, templateId);
      if (!before.ok) return before;
      const normalised: string[] = [];
      for (const tag of tags) {
        const next = normaliseTag(tag);
        if (!next.ok) return next;
        if (!normalised.includes(next.value)) normalised.push(next.value);
      }
      const after = await store.setMeta(templateId, { tags: normalised }, context);
      if (!after.ok) return after;
      return ok({
        result: { templateId, tags: normalised },
        inverse: { name: N.setTags, payload: { projectId: null, templateId, tags: before.value.tags } },
      });
    },
  });

  const setFavourite = defineCommand({
    name: N.setFavourite,
    payload: P[N.setFavourite],
    sideEffect: 'write',
    handle: async ({ templateId, favourite }, context) => {
      if (!libraryMetadata) return libraryNotServed();
      const before = await storedSummary(store, templateId);
      if (!before.ok) return before;
      const after = await store.setMeta(templateId, { favourite }, context);
      if (!after.ok) return after;
      return ok({
        result: { templateId, favourite },
        inverse: {
          name: N.setFavourite,
          payload: { projectId: null, templateId, favourite: before.value.favourite },
        },
      });
    },
  });

  const setTrendDate = defineCommand({
    name: N.setTrendDate,
    payload: P[N.setTrendDate],
    sideEffect: 'write',
    handle: async ({ templateId, trendFreshness }, context) => {
      if (!libraryMetadata) return libraryNotServed();
      const before = await storedSummary(store, templateId);
      if (!before.ok) return before;
      const after = await store.setMeta(templateId, { trendFreshness }, context);
      if (!after.ok) return after;
      return ok({
        result: { templateId, trendFreshness },
        inverse: {
          name: N.setTrendDate,
          payload: { projectId: null, templateId, trendFreshness: before.value.trendFreshness },
        },
      });
    },
  });

  const moveToFolder = defineCommand({
    name: N.moveToFolder,
    payload: P[N.moveToFolder],
    sideEffect: 'write',
    handle: async ({ templateIds, folderId }, context) => {
      if (!libraryMetadata) return libraryNotServed();
      const ids = [...new Set(templateIds)];
      if (folderId !== null) {
        const listed = await folders.list();
        if (!listed.ok) return listed;
        if (!listed.value.some((folder) => folder.id === folderId)) return err(FolderNotFound());
      }
      const previous: { templateId: TemplateId; folderId: typeof folderId }[] = [];
      for (const templateId of ids) {
        const before = await storedSummary(store, templateId);
        if (!before.ok) return before;
        previous.push({ templateId, folderId: before.value.folderId });
      }
      for (const templateId of ids) {
        const moved = await store.setMeta(templateId, { folderId }, context);
        if (!moved.ok) return moved;
      }
      return ok({
        result: { templateIds: ids, folderId },
        inverse: { name: N.restoreFolders, payload: { projectId: null, moves: previous } },
      });
    },
  });

  const restoreFolders = defineCommand({
    name: N.restoreFolders,
    payload: P[N.restoreFolders],
    sideEffect: 'write',
    internal: true,
    handle: async ({ moves }, context) => {
      if (!libraryMetadata) return libraryNotServed();
      for (const move of moves) {
        const restored = await store.setMeta(move.templateId, { folderId: move.folderId }, context);
        if (!restored.ok) return restored;
      }
      return ok({ result: { templateIds: moves.map((move) => move.templateId) } });
    },
  });

  const all: AnyCommand[] = [setTags, setFavourite, setTrendDate, moveToFolder, restoreFolders];
  return { setTags, setFavourite, setTrendDate, moveToFolder, restoreFolders, all };
}
