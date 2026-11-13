// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `template.addStarter` (P3-B3): fork a bundled hub document under the caller's id.
 * The payload has no locale; provenance uses the starter's language, or English when it is global.
 * Inverse is `template.discard`. Redo recreates it when undo removed it. core.not_implemented on a store that
 * would drop the `starter` provenance.
 */
import {
  ConflictError,
  defineCommand,
  err,
  newId,
  NotFoundError,
  ok,
  TEMPLATE_COMMANDS,
  templateCommandPayloads,
  type AnyCommand,
  type Clock,
  type TemplateStore,
} from '@taalcut/core';
import { StarterNotFound } from '../errors';
import { fromHubTemplate } from '../hub/from-hub';
import { libraryNotServed } from '../library/library-metadata';
import { starterProvenanceLocale } from './catalogue';
import { STARTER_MANIFEST } from './manifest';
import { loadStarter } from './starter-service';

const N = TEMPLATE_COMMANDS;

export function createStarterCommands(deps: {
  readonly store: TemplateStore;
  readonly clock: Clock;
  /** The store keeps provenance (library-metadata.ts); otherwise the fork would read as the person's own. */
  readonly libraryMetadata: boolean;
}) {
  const { store, clock, libraryMetadata } = deps;
  const addStarter = defineCommand({
    name: N.addStarter,
    payload: templateCommandPayloads[N.addStarter],
    sideEffect: 'write',
    handle: async ({ starterId, templateId }, context) => {
      if (!libraryMetadata) return libraryNotServed();
      const entry = STARTER_MANIFEST.find((item) => item.id === starterId);
      if (!entry) return err(StarterNotFound());
      const existing = await store.get(templateId);
      if (existing.ok) {
        if (!existing.value.summary.archived)
          return err(ConflictError({ entity: 'template', id: templateId }));
        const restored = await store.setMeta(templateId, { archived: false }, context);
        if (!restored.ok) return restored;
      } else if (NotFoundError.is(existing.error)) {
        const loaded = await loadStarter(entry);
        if (!loaded.ok) return loaded;
        const forked = fromHubTemplate(
          loaded.value,
          { template: () => templateId, slot: () => newId(), overlay: () => newId() },
          clock.now(),
        );
        if (!forked.ok) return forked;
        const created = await store.create(
          forked.value,
          {
            name: entry.id,
            projectId: null,
            listed: true,
            provenance: {
              kind: 'starter',
              starterId: entry.id,
              locale: starterProvenanceLocale(entry.locales),
            },
          },
          context,
        );
        if (!created.ok) return created;
      } else return existing;
      return ok({
        result: { templateId, version: 1 },
        inverse: { name: N.discard, payload: { projectId: null, templateId } },
      });
    },
  });
  const all: AnyCommand[] = [addStarter];
  return { addStarter, all };
}
