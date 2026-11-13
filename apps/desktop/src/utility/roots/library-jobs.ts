// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library in the jobs process (packages/library SPEC, "Where it runs"):
 * its job kinds (scan, hash, find missing, staging sweep, collect), the folder
 * watcher, the indexing pipeline over the job queue and its `indexing`
 * namespace, and the daily housekeeping.
 *
 * Index stages are data: each package that does indexing work exports its
 * IndexStageDefinitions; the jobs root lists them all (index-stages.ts) on
 * IndexStagesToken. The library never imports those packages itself.
 */
import {
  ClockToken,
  createToken,
  EmbeddingIndexToken,
  EventBusToken,
  JobQueueToken,
  type Container,
  type IndexStageDefinition,
  type JobId,
  type JobKind,
  type JobQueue,
  type JobRegistration,
} from '@taalcut/core';
import {
  createFolderWatcher,
  createImportSink,
  createIndexingPipeline,
  createLibraryJobs,
  createStyleStore,
  createTemplateStore,
  createTimelineVersions,
  collectJob,
  indexingRouter,
  libraryHashStage,
  sweepStagingJob,
  type FolderWatcher,
  type IndexingPipeline,
} from '@taalcut/library';
import { PlatformServicesToken } from '../../platform';
import { styleAssetsDir } from '../../shared/template-assets';
import { LibraryDatabaseToken, UtilityConfigToken } from '../../shared/tokens';
import { IndexStagesToken } from './index-stages';
import { originalsRoot, templateAssetsDir } from './library-agent';
import { libraryStockPorts } from './library-stock';

/** Without IndexStagesToken (tests): library.hash alone. */
export const INDEX_STAGES: readonly IndexStageDefinition[] = [libraryHashStage];

const IndexingPipelineToken = createToken<IndexingPipeline>('desktop.indexingPipeline');
const FolderWatcherToken = createToken<FolderWatcher>('desktop.folderWatcher');
/** The daily sweep and collect, cleared with the container. */
const HousekeepingToken = createToken<{
  readonly first: ReturnType<typeof setTimeout>;
  readonly timer: ReturnType<typeof setInterval>;
}>('desktop.libraryHousekeeping');

const DAY_MS = 86_400_000;
/** The first sweep and collect wait for launch to settle; they are never urgent. */
const FIRST_HOUSEKEEPING_MS = 120_000;
/** Housekeeping sits below everything the user waits for: enqueued at the kinds' own `low`. */
const HOUSEKEEPING = [sweepStagingJob, collectJob] as const;
const log = (message: string) => console.warn(`[library] ${message}`);

/** The library's job kinds, to register on the engine beside media's. */
/** Download over the shared port; Local only is read again by each job before it fetches. */
function stockPorts(container: Container) {
  const { http, localOnly } = libraryStockPorts(container);
  return { http, localOnly };
}

export function libraryJobs(container: Container): JobRegistration[] {
  const db = container.resolve(LibraryDatabaseToken);
  const events = container.resolve(EventBusToken);
  // Vision registers the active space's index when it lands; until then there are no vectors to remove.
  const vectors = container.has(EmbeddingIndexToken) ? container.resolve(EmbeddingIndexToken) : undefined;
  const versions = createTimelineVersions(db);
  const { userData } = container.resolve(UtilityConfigToken);
  const templates = createTemplateStore(db, { assetsDir: templateAssetsDir(userData) });
  const styles = createStyleStore(db, { assetsDir: styleAssetsDir(userData) });
  return createLibraryJobs({
    db,
    events,
    importSink: createImportSink(db, {
      originalsRoot: async () => originalsRoot(db),
      events,
      volumes: container.resolve(PlatformServicesToken).volumeProbe(),
    }),
    collect: {
      pruneAutoVersions: () => versions.pruneAutos(),
      pruneTemplateAssets: () => templates.pruneAssets(),
      pruneStyleAssets: () => styles.pruneAssets(),
    },
    ...(vectors ? { vectors } : {}),
    stock: {
      ...stockPorts(container),
      originalsRoot: () => originalsRoot(db),
    },
    log,
  });
}

/** The pipeline and the watcher, made on first use and stopped with the container. */
export function registerLibraryJobs(container: Container): void {
  container.factory(
    IndexingPipelineToken,
    ({ db, queue, events, clock }) => {
      const wiring = container.has(IndexStagesToken) ? container.resolve(IndexStagesToken) : undefined;
      return createIndexingPipeline({
        db,
        queue,
        events,
        clock,
        stages: wiring?.stages ?? INDEX_STAGES,
        ...(wiring?.duplicates ? { duplicates: wiring.duplicates } : {}),
        ...(wiring?.notReady ? { notReady: wiring.notReady } : {}),
        // A skip that clears vectors (round IX3) removes them from the active space's index, once vision has one.
        vectors: () =>
          container.has(EmbeddingIndexToken) ? container.resolve(EmbeddingIndexToken) : undefined,
        log,
      });
    },
    {
      deps: { db: LibraryDatabaseToken, queue: JobQueueToken, events: EventBusToken, clock: ClockToken },
      dispose: (pipeline) => pipeline.stop(),
    },
  );
  container.factory(FolderWatcherToken, ({ db }) => createFolderWatcher({ db, log }), {
    deps: { db: LibraryDatabaseToken },
    dispose: (watcher) => watcher.stop(),
  });
  container.factory(
    HousekeepingToken,
    ({ queue, clock }) => {
      const run = () => void housekeeping(queue, clock.now());
      const first = setTimeout(run, FIRST_HOUSEKEEPING_MS);
      const timer = setInterval(run, DAY_MS);
      first.unref();
      timer.unref();
      return { first, timer };
    },
    {
      deps: { queue: JobQueueToken, clock: ClockToken },
      dispose: ({ first, timer }) => {
        clearTimeout(first);
        clearInterval(timer);
      },
    },
  );
}

/**
 * What the media cache asks before it evicts a file (UX2 rounds 3 and 4, cache-cap.ts): false keeps it (a window
 * shows its clip, or a stage of it is fed, queued or running); true means the library let it go (its row is gone).
 */
export function releaseCacheFile(container: Container, key: string): boolean {
  return container.resolve(IndexingPipelineToken).release(key);
}

/** The jobs process's `indexing` namespace. */
export function libraryIndexingRouter(container: Container) {
  return indexingRouter(container.resolve(IndexingPipelineToken));
}

/**
 * The job engine's after-job step (round IX, depth-first): the pipeline stores a finished stage's outcome
 * and feeds what it unblocked before the engine offers the slot again (at once for other jobs).
 */
export function indexingSettled(container: Container, jobId: JobId): Promise<void> {
  return container.resolve(IndexingPipelineToken).settled(jobId);
}

/** Housekeeping jobs, keyed per day so a restart the same day doesn't add another. */
export async function housekeeping(
  queue: Pick<JobQueue, 'enqueue'>,
  now: number,
  kinds: readonly Pick<JobKind<unknown, unknown>, 'kind' | 'priority'>[] = HOUSEKEEPING,
): Promise<void> {
  const day = new Date(now).toISOString().slice(0, 10);
  for (const { kind, priority } of kinds) {
    const queued = await queue.enqueue({ kind, input: {}, priority, idempotencyKey: `${kind}:${day}` });
    if (!queued.ok) log(`${kind} not enqueued: ${queued.error.code}`);
  }
}

/**
 * A component was installed (UX2-MODELS): the stage wiring re-reads which models are here, then the stages that
 * wait for one look again at once (a held stage probes one row; a stage notReady held back is fed).
 */
export async function modelsInstalled(container: Container): Promise<void> {
  if (container.has(IndexStagesToken)) await container.resolve(IndexStagesToken).refresh();
  await container.resolve(IndexingPipelineToken).modelsInstalled();
}

/**
 * After the engine has started (it takes back the dead boot's leases first): the pipeline reconciles and
 * feeds, the watcher starts (a full scan of every watched source), and the staging sweep and collect run
 * two minutes later and then daily (once a day however often the app starts).
 */
export async function startLibraryJobs(container: Container): Promise<void> {
  if (container.has(IndexStagesToken)) await container.resolve(IndexStagesToken).refresh();
  await container.resolve(IndexingPipelineToken).start();
  container.resolve(FolderWatcherToken).start();
  container.resolve(HousekeepingToken);
}
