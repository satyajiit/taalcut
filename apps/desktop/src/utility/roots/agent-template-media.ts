// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * REF1-KEEP in the agent process: the library's template media store (a template keeps its reel's video and music,
 * in `<userData>/templates/media/<template id>/`), the folders a delete leaves pruned once it commits and at
 * start-up, and the router's `templates.fetchMedia`.
 */
import {
  createToken,
  ExperimentSandboxToken,
  JobRunnerToken,
  newId,
  ok,
  TEMPLATE_COMMANDS,
  TemplateMediaStoreToken,
  type AsyncResult,
  type CommandBus,
  type Container,
  type InstagramSessionProvider,
  type TemplatesService,
} from '@taalcut/core';
import { createTemplateMediaStore, type LibraryTemplateMediaStore } from '@taalcut/library';
import { templatesFetchMedia, type TemplateService } from '@taalcut/templates';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { templatesRoot } from '../../shared/template-assets';
import { LibraryDatabaseToken } from '../../shared/tokens';

/** The library's store itself (TemplateMediaStoreToken's), for its prune. */
const LibraryTemplateMediaToken = createToken<LibraryTemplateMediaStore>('desktop.libraryTemplateMedia');

/** The first prune waits for launch to settle; it is never urgent. */
export const FIRST_MEDIA_PRUNE_MS = 60_000;

/** The media store, where this process has the library (lazy: nothing opens until something resolves it). */
export function registerTemplateMedia(container: Container, config: Pick<UtilityConfig, 'userData'>): void {
  if (container.has(TemplateMediaStoreToken) || !container.has(LibraryDatabaseToken)) return;
  container
    .factory(
      LibraryTemplateMediaToken,
      ({ db }) => createTemplateMediaStore(db, { templatesRoot: templatesRoot(config.userData) }),
      { deps: { db: LibraryDatabaseToken } },
    )
    .factory(TemplateMediaStoreToken, ({ media }) => media, { deps: { media: LibraryTemplateMediaToken } });
}

const DELETES = new Set<string>([
  TEMPLATE_COMMANDS.remove,
  TEMPLATE_COMMANDS.discard,
  TEMPLATE_COMMANDS.discardMany,
]);

/** A change that may have removed a template: a delete or discard, or an undo of what made one. */
export function mayRemoveTemplate(change: { readonly kind: string; readonly name: string }): boolean {
  if (change.kind === 'executed') return DELETES.has(change.name);
  return change.kind === 'undone' && (change.name.startsWith('template.') || change.name.startsWith('hub.'));
}

/**
 * Deleting a template deletes its media: the row goes with it in the command's transaction, and the folder here
 * once the command has committed. Also at start-up, for a delete the app quit before pruning.
 */
export function pruneMediaAfterDeletes(
  container: Container,
  bus: Pick<CommandBus, 'subscribe'>,
  log: (message: string) => void = (message) => console.warn(`[templates] ${message}`),
): void {
  if (!container.has(LibraryTemplateMediaToken)) return;
  const prune = () => {
    try {
      const pruned = container.resolve(LibraryTemplateMediaToken).prune();
      if (!pruned.ok) log(`media prune failed: ${pruned.error.code}`);
    } catch (cause) {
      log(`media prune threw: ${String(cause)}`);
    }
  };
  bus.subscribe((change) => {
    if (mayRemoveTemplate(change)) prune();
  });
  setTimeout(prune, FIRST_MEDIA_PRUNE_MS).unref?.();
}

/** The media store for the templates tools, when there is one. */
export function templateMediaDeps(container: Container) {
  return container.has(TemplateMediaStoreToken) ? { media: container.resolve(TemplateMediaStoreToken) } : {};
}

/** The Instagram session's cookies for a fetch's second try, as the tools take them. */
export function instagramCookiesOf(sessionProvider: InstagramSessionProvider | undefined) {
  if (!sessionProvider) return {};
  return {
    instagramCookies: async (): AsyncResult<string | null> => {
      const session = await sessionProvider.getSession();
      return session.ok ? ok(session.value?.cookiesNetscape ?? null) : session;
    },
  };
}

/** The router's `templates.fetchMedia`, where the media store, the sandbox and the job runner are all here. */
export function fetchMediaService(
  container: Container,
  service: TemplateService,
  sessionProvider: InstagramSessionProvider | undefined,
): Pick<TemplatesService, 'fetchMedia'> {
  if (
    !container.has(TemplateMediaStoreToken) ||
    !container.has(ExperimentSandboxToken) ||
    !container.has(JobRunnerToken)
  )
    return {};
  return {
    fetchMedia: (input) =>
      templatesFetchMedia({
        service,
        media: container.resolve(TemplateMediaStoreToken),
        sandbox: container.resolve(ExperimentSandboxToken),
        jobs: container.resolve(JobRunnerToken),
        ids: {
          template: () => newId<'Template'>(),
          slot: () => newId<'TemplateSlot'>(),
          overlay: () => newId<'TextOverlay'>(),
          experiment: () => newId<'Experiment'>(),
        },
        ...instagramCookiesOf(sessionProvider),
      })(input),
  };
}
