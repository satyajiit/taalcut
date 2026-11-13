// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Command handlers for `INSTAGRAM_SAVED_COMMANDS` (`setWatch`,
 * `syncCollection`, `linkTemplate`). `setWatch` and `linkTemplate` provide
 * inverses so they participate in app-wide undo/redo.
 */
import {
  defineCommand,
  err,
  INSTAGRAM_SAVED_COMMANDS,
  instagramCollectionNotFoundError,
  instagramSavedCommandPayloads,
  ok,
  type AnyCommand,
  type InstagramSavedStore,
} from '@taalcut/core';
import type { InstagramSavedService } from './instagram-service';

const N = INSTAGRAM_SAVED_COMMANDS;
const P = instagramSavedCommandPayloads;

export function createInstagramSavedCommands(deps: {
  readonly store: InstagramSavedStore;
  readonly service: InstagramSavedService;
}) {
  const { store, service } = deps;

  const setWatch = defineCommand({
    name: N.setWatch,
    payload: P[N.setWatch],
    sideEffect: 'write',
    handle: async ({ collectionId, watched, autoBreakdown }, context) => {
      const before = await store.getCollection(collectionId);
      if (!before.ok) return before;
      if (!before.value) return err(instagramCollectionNotFoundError({ collectionId }));

      const updated = await store.setWatch({ collectionId, watched, autoBreakdown }, context);
      if (!updated.ok) return updated;

      return ok({
        result: updated.value,
        inverse: {
          name: N.setWatch,
          payload: {
            projectId: null,
            collectionId,
            watched: before.value.watched,
            autoBreakdown: before.value.autoBreakdown,
          },
        },
      });
    },
  });

  const syncCollection = defineCommand({
    name: N.syncCollection,
    payload: P[N.syncCollection],
    sideEffect: 'write',
    handle: async ({ collectionId }, context) => {
      // Do not pass `context` into multi-step network syncs so SQLite transactions aren't held open across HTTP fetches.
      void context;
      const synced = await service.sync(collectionId ? { collectionId } : undefined);
      if (!synced.ok) return synced;
      return ok({ result: synced.value });
    },
  });

  const linkTemplate = defineCommand({
    name: N.linkTemplate,
    payload: P[N.linkTemplate],
    sideEffect: 'write',
    handle: async ({ shortcode, templateId }, context) => {
      const linked = await store.linkTemplate(shortcode, templateId, context);
      if (!linked.ok) return linked;
      return ok({
        result: { shortcode, templateId },
        inverse: {
          name: N.linkTemplate,
          payload: {
            projectId: null,
            shortcode,
            templateId: linked.value.previousTemplateId,
          },
        },
      });
    },
  });

  const all: AnyCommand[] = [setWatch, syncCollection, linkTemplate];
  return { setWatch, syncCollection, linkTemplate, all };
}
