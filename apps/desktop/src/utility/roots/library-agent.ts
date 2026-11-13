// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library in the agent process (packages/library SPEC, "Where it runs"):
 * its stores by core's tokens, the library, re-index and project commands,
 * hybrid search over the jobs process's embedder, the `library` and
 * `projects` namespaces, and what the library's agent tools need.
 *
 * Search starts keyword-only: the embedding model is the vision lane's and
 * may not be installed yet. Each search asks main for the embedding space
 * again at most every 30 s; once the jobs process answers, the query
 * embedder and the active space's vector index are used.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  CommandBusToken,
  createCommitAnnouncer,
  createToken,
  DERIVED_KEY_PATTERN,
  embedderOverRpc,
  EventBusToken,
  ok,
  ProjectBudgetStoreToken,
  RenderStoreToken,
  SettingsStoreToken,
  TemplateStoreToken,
  TimelineStoreToken,
  type AnyCommand,
  type MainServicesClient,
  type Container,
  type SourceId,
} from '@taalcut/core';
import {
  createLibraryCommands,
  createPlaceCommands,
  createLibrarySearch,
  createLibraryService,
  createProjectBudgetStore,
  createProjectCommands,
  createProjectsService,
  createReindexCommand,
  createRenderStore,
  createSetAssetLanguageCommand,
  createRepositories,
  createSettingsRepository,
  createTemplateStore,
  createTimelineStore,
  createWasmContentHasher,
  libraryRouter,
  openVectorIndex,
  ORIGINALS_ROOT_SETTING,
  projectsRouter,
  readImportStatus,
  type ContactSheetPictures,
  type LibraryDatabase,
  type LibrarySearch,
  type LibrarySearchPort,
  type LibraryTimelineStore,
  type LibraryToolDeps,
} from '@taalcut/library';
import { PlatformServicesToken } from '../../platform';
import { notedTemplateStore } from '@taalcut/templates';
import { mediaCacheRoot } from '../../shared/media-cache';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { templateAssetsDir } from '../../shared/template-assets';
import {
  AgentMainServicesToken,
  CommandUnitOfWorkToken,
  LibraryDatabaseToken,
  LibraryPortsToken,
  UtilityConfigToken,
} from '../../shared/tokens';
import { registerTemplateIndex, TemplateWriteNotesToken } from './agent-template-index';
import { cachedWaveformReader } from './asset-waveform';
import { libraryStockPorts } from './library-stock';

/** ADR 0001, "Where files live": phone imports land here until the user moves the root. */
export const DEFAULT_ORIGINALS_ROOT = join(homedir(), 'Movies', 'Taalcut', 'Originals');

// Shared with main, which serves the assets on app://media/templates/… (shared/template-assets.ts).
export { templateAssetsDir } from '../../shared/template-assets';

export const LibrarySearchToken = createToken<LibrarySearchPort>('desktop.librarySearch');
const LibraryTimelinesToken = createToken<LibraryTimelineStore>('desktop.libraryTimelines');

const SPACE_RETRY_MS = 30_000;

/** The originals root now: the setting, or the default (a synchronous read for the storage view). */
export function originalsRoot(db: LibraryDatabase): string {
  const set = createSettingsRepository(db).get(ORIGINALS_ROOT_SETTING.key, ORIGINALS_ROOT_SETTING.schema);
  return (set.ok ? set.value : null) ?? DEFAULT_ORIGINALS_ROOT;
}

/** Keyword search until the jobs process serves embeddings, then hybrid search in its space. */
function lazySearch(db: LibraryDatabase, main?: () => MainServicesClient<'agent'>): LibrarySearchPort {
  const keywordOnly = createLibrarySearch({ db, vectors: null, embedder: null });
  let hybrid: LibrarySearch | undefined;
  let lastTry = Number.NEGATIVE_INFINITY;

  async function current(): Promise<LibrarySearch> {
    if (hybrid || !main || Date.now() - lastTry < SPACE_RETRY_MS) return hybrid ?? keywordOnly;
    lastTry = Date.now();
    try {
      const space = await main().embeddings.space();
      const vectors = openVectorIndex(db, { name: space.indexName, dimensions: space.dimensions });
      // Without sqlite-vec in this connection there is no index: keyword search until the next start.
      if (!vectors.ok) return keywordOnly;
      hybrid = createLibrarySearch({
        db,
        vectors: vectors.value,
        embedder: embedderOverRpc(() => main().embeddings, space),
      });
    } catch {
      // The embedding model isn't served yet (vision, P2-L9): keep answering from keywords.
    }
    return hybrid ?? keywordOnly;
  }

  return {
    search: async (query, filters, limit) => (await current()).search(query, filters, limit),
    findSimilar: async (shotId, filters, limit, excludeSameAsset) =>
      (await current()).findSimilar(shotId, filters, limit, excludeSameAsset),
  };
}

/** The stores core's ports name, and search. Lazy: nothing opens until something resolves them. */
export function registerLibraryAgent(container: Container, config: UtilityConfig): void {
  const withPorts = { deps: { db: LibraryDatabaseToken, ports: LibraryPortsToken } };
  container
    .factory(
      LibraryTimelinesToken,
      ({ db, ports }) => createTimelineStore(db, { commands: ports.commands }),
      withPorts,
    )
    .factory(TimelineStoreToken, ({ timelines }) => timelines, { deps: { timelines: LibraryTimelinesToken } })
    .factory(
      TemplateStoreToken,
      // LRN1-TPL: every template write passes through here; the notes announce each one once its command commits.
      ({ db, ports, notes }) =>
        notedTemplateStore(
          createTemplateStore(db, {
            assetsDir: templateAssetsDir(config.userData),
            commands: ports.commands,
          }),
          notes,
        ),
      { deps: { ...withPorts.deps, notes: TemplateWriteNotesToken } },
    )
    .factory(RenderStoreToken, ({ db }) => createRenderStore(db), { deps: { db: LibraryDatabaseToken } })
    .factory(
      ProjectBudgetStoreToken,
      ({ db, ports }) => createProjectBudgetStore(db, { commands: ports.commands }),
      withPorts,
    )
    .factory(
      LibrarySearchToken,
      ({ db }) =>
        lazySearch(
          db,
          container.has(AgentMainServicesToken) ? container.resolve(AgentMainServicesToken) : undefined,
        ),
      { deps: { db: LibraryDatabaseToken } },
    );
  // The template index, its search and fit (LRN1-TPL), and the write notes the store above announces through.
  registerTemplateIndex(container);
}

/** The library's command handlers for the agent's bus: library.*, library.reindexAssets and project.*. */
export function libraryAgentCommands(container: Container, config: UtilityConfig): AnyCommand[] {
  const db = container.resolve(LibraryDatabaseToken);
  const commands = container.resolve(CommandUnitOfWorkToken);
  const settings = container.resolve(SettingsStoreToken);
  const stock = libraryStockPorts(container);
  const library = createLibraryCommands({
    db,
    folders: { protectedRoots: [config.userData], home: homedir() },
    commands,
    settings: container.resolve(LibraryPortsToken).settings,
    defaultOriginalsRoot: DEFAULT_ORIGINALS_ROOT,
    hasher: createWasmContentHasher(),
    volumes: container.resolve(PlatformServicesToken).volumeProbe(),
    stock: { http: stock.http, localOnly: stock.localOnly },
  });
  const bus = container.resolve(CommandBusToken);
  const events = container.resolve(EventBusToken);
  library.announce(bus, events);
  const reindexAnnouncer = createCommitAnnouncer();
  reindexAnnouncer.attach(bus, events);
  const projects = createProjectCommands({
    projects: createRepositories(db).projects,
    timelines: container.resolve(LibraryTimelinesToken),
    commands,
    settings,
  });
  // `library.changed` for each committed project command.
  projects.announce(bus, events);
  // LIB1-LANG: correcting a clip's spoken language; `library.changed` once each correction commits.
  const language = createSetAssetLanguageCommand({ db, commands });
  language.announce(bus, events);
  // LIB1-PLACE: library.renameTrip; its clips' summaries change once it commits.
  const places = createPlaceCommands({ db, commands });
  places.announce(bus, events);
  return [
    ...library.all,
    createReindexCommand({ db, commands, announcer: reindexAnnouncer }),
    language.command,
    ...projects.all,
    ...places.all,
  ] as AnyCommand[];
}

/** The agent's `library` and `projects` namespaces (in place of the core.not_implemented stubs). */
export function libraryAgentRouters(container: Container) {
  const db = container.resolve(LibraryDatabaseToken);
  const service = createLibraryService({
    db,
    search: container.resolve(LibrarySearchToken),
    originalsRoot: () => ({ path: originalsRoot(db) }),
    ...libraryStockPorts(container),
    // UX2: the clip page's sound lane reads the waveform from the media cache.
    waveform: cachedWaveformReader(mediaCacheRoot(container.resolve(UtilityConfigToken).userData)),
  });
  return {
    library: libraryRouter(service),
    projects: projectsRouter(createProjectsService(db)),
  };
}

/** What `libraryToolModule` needs; import status is read from the database (the pipeline writes it there). */
export function libraryToolDeps(
  db: LibraryDatabase,
  search: LibrarySearchPort,
  options?: {
    readonly container: Container;
    readonly pictures: () => Promise<ContactSheetPictures>;
  },
): LibraryToolDeps {
  return {
    db,
    search,
    importStatus: async (sourceId?: SourceId) => ok(readImportStatus(db, sourceId ? { sourceId } : {})),
    ...(options
      ? {
          contactSheet: async (sheet) => {
            if (
              !options.container.has(UtilityConfigToken) ||
              sheet.file.kind !== 'still' ||
              !DERIVED_KEY_PATTERN.test(sheet.file.key)
            ) {
              return ok(null);
            }
            const cacheRoot = mediaCacheRoot(options.container.resolve(UtilityConfigToken).userData);
            const bytes = await readFile(join(cacheRoot, sheet.file.key)).catch(() => null);
            if (!bytes) return ok(null);
            return ok({ bytes, pictures: await options.pictures() });
          },
        }
      : {}),
    home: homedir(),
  };
}
