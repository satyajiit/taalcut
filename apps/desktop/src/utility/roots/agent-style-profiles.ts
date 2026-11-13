// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Style profiles in the agent process (LRN1-STY), which owns templates: the library's StyleProfileStore, the
 * profiles service over the template store and the template index (exemplars), and its summaries written by this
 * process's background models (local first; the cloud only under a standing upload consent). It serves the two
 * template reads, the `styleProfile.use` command and the agent's style tools.
 *
 * The refresher follows template writes (`library.changed`, entity 'template': a breakdown, a new version, a folder
 * or tag change, a watched collection's sync) and after a quiet spell rebuilds what changed, keeping every watched
 * Instagram collection's profile built; a sync that queues breakdowns nudges the Reels' collections by name.
 */
import {
  ALL_SAVED_COLLECTION_ID,
  ClockToken,
  createToken,
  EventBusToken,
  InstagramSavedStoreToken,
  StyleProfileStoreToken,
  TemplateStoreToken,
  type CommandBus,
  type Container,
  type InstagramSavedReel,
  type StyleSource,
  type TemplatesService,
} from '@taalcut/core';
import { createStyleProfileStore } from '@taalcut/library';
import {
  createStyleProfileCommands,
  createStyleProfileRefresher,
  createStyleProfiles,
  withStyleProfileReads,
  type StyleProfileRefresher,
  type StyleProfiles,
} from '@taalcut/templates';
import { LibraryDatabaseToken, LibraryPortsToken } from '../../shared/tokens';
import { lazyBackgroundModels } from './agent-background-models';
import { openTemplateIndex } from './agent-template-index';

export const StyleProfilesToken = createToken<StyleProfiles>('desktop.styleProfiles');
const StyleProfileRefresherToken = createToken<StyleProfileRefresher>('desktop.styleProfileRefresher');

const log = (line: string) => console.warn(`[style profiles] ${line}`);

/** The watched Instagram collections' sets (none without the Saved store). */
function watchedSets(container: Container): () => Promise<readonly StyleSource[]> {
  return async () => {
    if (!container.has(InstagramSavedStoreToken)) return [];
    const listed = await container.resolve(InstagramSavedStoreToken).listCollections();
    if (!listed.ok) {
      log(`watched collections not read: ${listed.error.code}`);
      return [];
    }
    return listed.value
      .filter((collection) => collection.watched)
      .map((collection) => ({ kind: 'instagram-collection', collectionId: collection.id }));
  };
}

/** The store, the service and the refresher, lazy: nothing opens until something resolves them. */
export function registerStyleProfiles(container: Container): void {
  container.factory(
    StyleProfileStoreToken,
    ({ db, ports }) => createStyleProfileStore(db, { commands: ports.commands }),
    { deps: { db: LibraryDatabaseToken, ports: LibraryPortsToken } },
  );
  container.factory(
    StyleProfilesToken,
    ({ store, templates, events, clock }) =>
      createStyleProfiles({
        store,
        templates,
        index: () => openTemplateIndex(container),
        models: lazyBackgroundModels(container),
        events,
        clock,
        log,
      }),
    {
      deps: {
        store: StyleProfileStoreToken,
        templates: TemplateStoreToken,
        events: EventBusToken,
        clock: ClockToken,
      },
    },
  );
  container.factory(
    StyleProfileRefresherToken,
    ({ profiles, events }) =>
      createStyleProfileRefresher({ profiles, events, watched: watchedSets(container), log }),
    {
      deps: { profiles: StyleProfilesToken, events: EventBusToken },
      dispose: (refresher) => refresher.stop(),
    },
  );
}

/** The template reads over the profiles and `styleProfile.use` on the bus (agentTemplatesRouter). */
export function serveStyleProfiles<S extends TemplatesService>(
  container: Container,
  bus: CommandBus,
  service: S,
) {
  if (!container.has(StyleProfilesToken)) return service;
  bus.register(...createStyleProfileCommands({ store: container.resolve(StyleProfileStoreToken) }).all);
  return withStyleProfileReads(service, container.resolve(StyleProfilesToken));
}

/** `templates.styleProfile` and `templates.useStyleProfile` (templatesAgentToolModules). */
export function styleProfileToolDeps(container: Container): { readonly styleProfiles?: StyleProfiles } {
  return container.has(StyleProfilesToken) ? { styleProfiles: container.resolve(StyleProfilesToken) } : {};
}

/** A sync queued breakdowns of these Reels: their collections' sets (and All saved) are built once they land. */
export function nudgeStyleProfiles(container: Container, reels: readonly InstagramSavedReel[]): void {
  if (!container.has(StyleProfileRefresherToken)) return;
  const collections = new Set([ALL_SAVED_COLLECTION_ID, ...reels.map((reel) => reel.collectionId)]);
  container
    .resolve(StyleProfileRefresherToken)
    .nudge([...collections].map((collectionId) => ({ kind: 'instagram-collection', collectionId })));
}

/** Follows template writes from the agent's start. */
export function startStyleProfiles(container: Container): void {
  if (container.has(StyleProfileRefresherToken)) container.resolve(StyleProfileRefresherToken);
}
