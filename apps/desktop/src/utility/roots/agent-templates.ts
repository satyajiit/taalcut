// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * @taalcut/templates in the agent process (P2-T3 to P2-T8): the template
 * service over the library's TemplateStore, the template commands on the bus
 * (create, rename, archive, delete and the slot edits, all undoable), the
 * `templates` and `sandbox` tools and the Analyst's sandbox.
 *
 * The experiment sandbox here is in job mode: folders under
 * `<userData>/scratch` are opened and read in this process, and every run
 * goes to the jobs process as a `sandbox.run` job, so children only ever
 * start there (packages/tools, P2-T2). Fetches and breakdowns are jobs too.
 * REF1: a template keeps its reel in the library's media store
 * (agent-template-media.ts); `templates.fetchMedia` gets an older one's.
 */
import { join } from 'node:path';
import {
  AcknowledgementStoreToken,
  ChatServiceToken,
  ClockToken,
  CommandBusToken,
  createToken,
  err,
  EventBusToken,
  ExperimentSandboxToken,
  INSTAGRAM_SAVED_COMMANDS,
  InstagramSavedStoreToken,
  InstagramSessionProviderToken,
  JobRunnerToken,
  newId,
  NotFoundError,
  notServedRouter,
  ok,
  StyleStoreToken,
  TEMPLATE_COMMANDS,
  TemplateFolderStoreToken,
  TemplateSearchToken,
  TemplateStoreToken,
  templatesContract,
  templatesRouter,
  type AssetId,
  type Container,
  type InstagramSessionProvider,
  type ToolModule,
} from '@taalcut/core';
import { createAssetLocationRepository } from '@taalcut/library';
import { ModelClientToken, ModelProfilesToken, ModelRuntimeToken } from '@taalcut/models';
import {
  createBreakdownJobLog,
  createEnergyCommands,
  createFolderCommands,
  createImportCommands,
  createInstagramSavedCommands,
  createInstagramSavedService,
  createInstagramWebClient,
  createMetadataCommands,
  createSetStyleCommand,
  createStarterCatalogue,
  createStarterCommands,
  createTemplateCommands,
  createTemplateService,
  stripDescriber,
  templatesToolModule,
  withLibraryReads,
  type BreakdownJobLog,
  type DescribeStrip,
  type InstagramSavedService,
} from '@taalcut/templates';
import { createExperimentSandbox, sandboxToolModule } from '@taalcut/tools';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { LibraryDatabaseToken } from '../../shared/tokens';
import { moduleContextWindow } from './model-windows';
import {
  fetchMediaService,
  instagramCookiesOf,
  pruneMediaAfterDeletes,
  registerTemplateMedia,
  templateMediaDeps,
} from './agent-template-media';
import { nudgeStyleProfiles, serveStyleProfiles, styleProfileToolDeps } from './agent-style-profiles';
import { proposeEditsService } from './agent-template-review';
import { graphicModelOf } from './agent-graphics';

/** Each breakdown's job, recorded by the breakdown tool and shown on the Analyst's card (one log for both). */
export const BreakdownJobLogToken = createToken<BreakdownJobLog>('desktop.breakdownJobLog');
const InstagramSavedServiceToken = createToken<InstagramSavedService>('desktop.instagramSavedService');
const WATCH_SYNC_INTERVAL_MS = 15 * 60 * 1000;

/** Experiments' scratch folders: Taalcut's own data, never inside a library source. */
export const scratchRoot = (userData: string): string => join(userData, 'scratch');

/**
 * Whether the library's TemplateStore keeps P3-V14's metadata (tags, folders, favourites, trend dates, provenance)
 * and filters `list` by it. It does (packages/library, migration 20), so `templates.list` with those filters, the
 * metadata commands, `template.addStarter`, `template.import` and `hub.fork` (agent-templates-hub.ts) are served.
 * False only for a store that would drop that metadata: they then answer core.not_implemented instead of an
 * unfiltered page or a lost change.
 */
export const LIBRARY_STORE_KEEPS_METADATA = true;

const unconfiguredInstagramSession: InstagramSessionProvider = {
  getSession: async () => ok(null),
  invalidate: async () => ok(undefined),
};

function resolveInstagramService(container: Container): InstagramSavedService | undefined {
  if (container.has(InstagramSavedServiceToken)) {
    return container.resolve(InstagramSavedServiceToken);
  }
  const igStore = container.has(InstagramSavedStoreToken)
    ? container.resolve(InstagramSavedStoreToken)
    : undefined;
  const acknowledgements = container.has(AcknowledgementStoreToken)
    ? container.resolve(AcknowledgementStoreToken)
    : undefined;
  if (!igStore || !acknowledgements) return undefined;
  const clock = container.resolve(ClockToken);
  const sessionProvider = container.has(InstagramSessionProviderToken)
    ? container.resolve(InstagramSessionProviderToken)
    : unconfiguredInstagramSession;
  const service = createInstagramSavedService({
    store: igStore,
    client: createInstagramWebClient({ sessionProvider, clock }),
    sessionProvider,
    acknowledgements,
    clock,
    onAutoBreakdown: async (reels) => {
      // LRN1-STY: the Reels' collections' style profiles follow their breakdowns.
      nudgeStyleProfiles(container, reels);
      if (!container.has(ChatServiceToken)) return 0;
      const chat = container.resolve(ChatServiceToken);
      let queued = 0;
      for (const reel of reels) {
        const started = await chat.send(
          {
            conversationId: newId<'Conversation'>(),
            text: `Break down this saved Instagram Reel into a reusable template only: ${reel.permalink}`,
          },
          { signal: new AbortController().signal },
        );
        if (started.ok) {
          void started.value.events[Symbol.asyncIterator]().return?.(undefined);
          queued++;
        }
      }
      return queued;
    },
  });
  container.value(InstagramSavedServiceToken, service);
  return service;
}

const INSTAGRAM_COMMAND_NAMES = new Set<string>(Object.values(INSTAGRAM_SAVED_COMMANDS));

export function agentTemplatesRouter(container: Container) {
  if (!container.has(TemplateStoreToken)) return notServedRouter(templatesContract, 'templates');
  const store = container.resolve(TemplateStoreToken);
  const clock = container.resolve(ClockToken);
  const base = createTemplateService({ store, clock, libraryMetadata: LIBRARY_STORE_KEEPS_METADATA });
  const bus = container.resolve(CommandBusToken);
  bus.register(
    ...createTemplateCommands({ service: base, store }).all,
    ...createStarterCommands({ store, clock, libraryMetadata: LIBRARY_STORE_KEEPS_METADATA }).all,
    ...createEnergyCommands({ service: base }).all,
    ...createImportCommands({ store, clock, libraryMetadata: LIBRARY_STORE_KEEPS_METADATA }).all,
  );
  const folders = container.has(TemplateFolderStoreToken)
    ? container.resolve(TemplateFolderStoreToken)
    : undefined;
  const styles = container.has(StyleStoreToken) ? container.resolve(StyleStoreToken) : undefined;
  if (folders) {
    bus.register(
      ...createFolderCommands({ folders }).all,
      ...createMetadataCommands({ store, folders, libraryMetadata: LIBRARY_STORE_KEEPS_METADATA }).all,
    );
  }
  if (styles) bus.register(createSetStyleCommand({ service: base, styles }));
  // REF1: a deleted template's media folder goes once the delete commits.
  pruneMediaAfterDeletes(container, bus);

  const igStore = container.has(InstagramSavedStoreToken)
    ? container.resolve(InstagramSavedStoreToken)
    : undefined;
  const igService = resolveInstagramService(container);
  if (igStore && igService) {
    bus.register(...createInstagramSavedCommands({ store: igStore, service: igService }).all);
    if (container.has(EventBusToken)) {
      const events = container.resolve(EventBusToken);
      bus.subscribe((entry) => {
        if (
          INSTAGRAM_COMMAND_NAMES.has(entry.name) ||
          entry.name === TEMPLATE_COMMANDS.create ||
          entry.name === TEMPLATE_COMMANDS.remove
        ) {
          events.emit('library.changed', {
            projectId: null,
            entity: 'template',
            change: 'updated',
            ids: [],
          });
        }
      });
    }
    const timer = setInterval(() => {
      void igService.status().then((st) => {
        if (!st.ok || !st.value.signedIn || st.value.watchedCollections === 0) return;
        void bus.dispatch(
          INSTAGRAM_SAVED_COMMANDS.syncCollection,
          { projectId: null },
          { source: 'agent', actor: 'instagram-watcher' },
        );
      });
    }, WATCH_SYNC_INTERVAL_MS);
    timer.unref?.();
  }

  const service = withLibraryReads(base, {
    starters: createStarterCatalogue(),
    ...(folders ? { folders } : {}),
    ...(styles ? { files: { store, styles, ids: { hub: () => newId<'HubTemplate'>() } } } : {}),
    ...(igService ? { instagram: igService } : {}),
  });
  // templates.search (LRN1-TPL): the template index's search (agent-template-index.ts), words alone until it opens.
  const search = container.has(TemplateSearchToken) ? container.resolve(TemplateSearchToken) : undefined;
  const sessionProvider = container.has(InstagramSessionProviderToken)
    ? container.resolve(InstagramSessionProviderToken)
    : undefined;
  // LRN1-STY: the style profile reads and styleProfile.use (agent-style-profiles.ts).
  return templatesRouter(
    serveStyleProfiles(container, bus, {
      ...service,
      ...(search ? { search: search.search.bind(search) } : {}),
      // REF1: "Get the reel's video and music" for a template made before its reel was kept.
      ...fetchMediaService(container, base, sessionProvider),
      // BRK1: "Tell Taalcut", proposed edits from a model call (agent-template-review.ts).
      ...proposeEditsService(container, base),
    }),
  );
}

/**
 * The job-mode sandbox (ExperimentSandboxToken), unless this process has one, the breakdown job log, and (REF1) the
 * template media store finalise keeps each reel in.
 */
export function registerExperimentSandbox(container: Container, config: UtilityConfig): void {
  if (!container.has(BreakdownJobLogToken)) container.value(BreakdownJobLogToken, createBreakdownJobLog());
  registerTemplateMedia(container, config);
  if (container.has(ExperimentSandboxToken)) return;
  container.factory(
    ExperimentSandboxToken,
    ({ jobs, clock }) => createExperimentSandbox({ root: scratchRoot(config.userData), jobs, clock }),
    { deps: { jobs: JobRunnerToken, clock: ClockToken } },
  );
}

/** A library asset's original, granted read-only to one sandbox run. */
function resolveInput(container: Container) {
  return async (assetId: AssetId) => {
    const found = createAssetLocationRepository(container.resolve(LibraryDatabaseToken))
      .listByAsset(assetId)
      .find((location) => location.state === 'present' && location.absolutePathCached);
    return found?.absolutePathCached
      ? ok(found.absolutePathCached)
      : err(NotFoundError({ entity: 'asset', id: assetId }));
  };
}

/** BRK1 looks: vision's describer over this root's models, when the root has them (a test root may not). */
function stripDescriberOf(container: Container): { describeStrip?: DescribeStrip } {
  if (![ModelClientToken, ModelProfilesToken, ModelRuntimeToken].every((token) => container.has(token)))
    return {};
  return {
    describeStrip: stripDescriber({
      jobs: container.resolve(JobRunnerToken),
      models: container.resolve(ModelClientToken),
      selector: container.resolve(ModelProfilesToken),
      runtime: container.resolve(ModelRuntimeToken),
    }),
  };
}

/** The `templates` and `sandbox` tool modules (the Analyst's, the Librarian's planFromFormat, the slot edits). */
export function templatesAgentToolModules(container: Container): ToolModule[] {
  const store = container.resolve(TemplateStoreToken);
  const clock = container.resolve(ClockToken);
  const sandbox = container.resolve(ExperimentSandboxToken);
  const sessionProvider = container.has(InstagramSessionProviderToken)
    ? container.resolve(InstagramSessionProviderToken)
    : undefined;
  const igService = resolveInstagramService(container);
  const baseService = createTemplateService({ store, clock });
  const analystWindow = moduleContextWindow(container);
  return [
    templatesToolModule({
      sandbox,
      store,
      service: igService ? withLibraryReads(baseService, { instagram: igService }) : baseService,
      jobs: container.resolve(JobRunnerToken),
      // REF1: finalise keeps the reel here; templates.fetchMedia gets an older template's.
      ...templateMediaDeps(container),
      clock,
      ids: {
        template: () => newId<'Template'>(),
        slot: () => newId<'TemplateSlot'>(),
        overlay: () => newId<'TextOverlay'>(),
        experiment: () => newId<'Experiment'>(),
      },
      ...(container.has(BreakdownJobLogToken)
        ? { breakdownJobs: container.resolve(BreakdownJobLogToken) }
        : {}),
      // templates.search (LRN1-TPL), over the template index (agent-template-index.ts).
      ...(container.has(TemplateSearchToken) ? { search: container.resolve(TemplateSearchToken) } : {}),
      // LRN1-CTX: the Analyst's window sizes templates.resolveCuts' pages (model-windows.ts).
      contextWindow: () => analystWindow('agent'),
      // templates.styleProfile and templates.useStyleProfile (LRN1-STY, agent-style-profiles.ts).
      ...styleProfileToolDeps(container),
      // BRK1 looks: every slot's strip described on this Mac (on-device vision models only, never a cloud one).
      ...stripDescriberOf(container),
      // DSG1-READ: each kept overlay read as design (the chat's model when it sees images; agent-graphics.ts).
      ...graphicModelOf(container),
      // The Instagram session, tried only when a reel needs a login (REF1: anonymous first).
      ...instagramCookiesOf(sessionProvider),
    }),
    sandboxToolModule({ sandbox, resolveInput: resolveInput(container) }),
  ];
}
