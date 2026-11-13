// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The template index in the agent process (LRN1-TPL): each template's document and slot-intent vectors in the
 * active embedding space, searched by `templates.search` (TemplateSearchToken) and read by `timeline.fitTemplates`
 * (TemplateFitterToken).
 *
 * The hook: every template write goes through the TemplateStore library-agent.ts binds, wrapped there with
 * notedTemplateStore and TemplateWriteNotesToken, which announces each committed write as `library.changed`
 * (entity 'template'). Once started, the index follows those events, and catches up with the whole store (the
 * reconciler) when the agent starts: templates written while it was closed, or a new space after the embedding
 * model changed, whose index starts empty.
 *
 * The index opens with the space, as casting's and library search's do: main is asked for the jobs process's
 * embedding space at the first need and again at most every 30 s until it answers. It is named
 * templateIndexName(space.indexName) and lives beside the library's index in the library database. A catch-up that
 * can't run (no space yet, or the model isn't installed) tries again after 30 s, 2 min, then every 10 min.
 */
import {
  CommandBusToken,
  createToken,
  err,
  EventBusToken,
  ok,
  templateIndexName,
  TemplateSearchToken,
  TemplateStoreToken,
  type Container,
  type Embedder,
  type EventBus,
  type TemplateSearch,
  type TemplateStore,
  type VectorIndex,
} from '@taalcut/core';
import {
  createShotProfileSource,
  createTemplateSearch,
  openVectorIndex,
  type LibraryDatabase,
} from '@taalcut/library';
import {
  createTemplateVectors,
  createTemplateWriteNotes,
  followTemplateWrites,
  type OpenTemplateIndex,
  type TemplateVectors,
  type TemplateWriteNotes,
} from '@taalcut/templates';
import { createTemplateFitter, type TemplateFitter } from '@taalcut/timeline';
import { EmbedderUnavailable } from '@taalcut/vision';
import { LibraryDatabaseToken } from '../../shared/tokens';
import { lazyEmbeddingSpace } from './agent-casting';
import { CastingConfigSourceToken } from './agent-casting-prefs';

export const TemplateWriteNotesToken = createToken<TemplateWriteNotes>('desktop.templateWriteNotes');
export const TemplateFitterToken = createToken<TemplateFitter>('desktop.templateFitter');
const TemplateSpaceToken = createToken<TemplateSpace>('desktop.templateSpace');
const TemplateIndexUpkeepToken = createToken<{ stop(): void }>('desktop.templateIndexUpkeep');

const CATCH_UP_RETRY_MS = [30_000, 120_000, 600_000] as const;

const log = (message: string) => console.warn(`[templates] ${message}`);

interface OpenSpace {
  /** The library's index in the space: the shots' frame vectors. */
  readonly library: VectorIndex;
  /** The template index in the same space. */
  readonly templates: VectorIndex;
  readonly embedder: Embedder;
  readonly vectors: TemplateVectors;
}

interface TemplateSpace {
  current(): Promise<OpenSpace | undefined>;
  /** The library's index if the space is open now (shot profiles read it synchronously). */
  library(): VectorIndex | null;
}

/**
 * The template index beside casting's space (`lazyEmbeddingSpace`: asked for at the first need, again at most every
 * 30 s until the jobs process answers): opened, with its writer, once per space the library's index is in.
 */
function lazyTemplateSpace(container: Container, db: LibraryDatabase, store: TemplateStore): TemplateSpace {
  const space = lazyEmbeddingSpace(container);
  let opened: OpenSpace | undefined;
  return {
    async current() {
      const active = await space.current();
      if (!active) return undefined;
      if (opened?.library === active.index) return opened;
      const { embedder } = active;
      const { indexName, dimensions } = embedder.space;
      const templates = openVectorIndex(db, { name: templateIndexName(indexName), dimensions });
      // Without sqlite-vec in this connection there is no index until the next start.
      if (!templates.ok) return undefined;
      const vectors = createTemplateVectors({ index: templates.value, embedder, store });
      opened = { library: active.index, templates: templates.value, embedder, vectors };
      return opened;
    },
    library: () => space.index(),
  };
}

/** Words alone until the space is open, then words, meaning and slot intents. */
function lazyTemplateSearch(db: LibraryDatabase, space: TemplateSpace): TemplateSearch {
  const keywordOnly = createTemplateSearch({ db, vectors: null, embedder: null });
  let hybrid: TemplateSearch | undefined;
  return {
    async search(query, signal) {
      const open = await space.current();
      if (!open) return keywordOnly.search(query, signal);
      hybrid ??= createTemplateSearch({ db, vectors: open.templates, embedder: open.embedder });
      return hybrid.search(query, signal);
    },
  };
}

/** Follows committed template writes, and catches the index up with the store until one catch-up succeeds. */
function keepTemplateIndex(space: TemplateSpace, events: EventBus): { stop(): void } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  const unfollow = followTemplateWrites({
    events,
    vectors: async () => (await space.current())?.vectors,
    onError: (error) => log(`a template write wasn't indexed (the next start catches up): ${error.code}`),
  });

  async function catchUp(): Promise<void> {
    const open = await space.current();
    const done = open ? await open.vectors.reconcile(controller.signal) : undefined;
    if (done?.ok) {
      const { written, removed, embedded } = done.value;
      if (written + removed > 0)
        log(`index caught up: ${written} written (${embedded} texts), ${removed} removed`);
      return;
    }
    if (controller.signal.aborted) return;
    if (failures === 0) log(`index catch-up waits: ${done ? done.error.code : 'no embedding space yet'}`);
    const wait = CATCH_UP_RETRY_MS[Math.min(failures, CATCH_UP_RETRY_MS.length - 1)];
    failures += 1;
    timer = setTimeout(() => void catchUp(), wait);
    timer.unref();
  }

  void catchUp();
  return {
    stop() {
      controller.abort();
      clearTimeout(timer);
      unfollow();
    },
  };
}

/**
 * The write notes (the hook library-agent.ts wraps the template store with), the lazily opened template index, the
 * template search and the fitter. Nothing opens until something resolves them; startTemplateIndex starts the upkeep.
 */
export function registerTemplateIndex(container: Container): void {
  const detach: (() => void)[] = [];
  container.factory(
    TemplateWriteNotesToken,
    ({ events, bus }) => {
      const notes = createTemplateWriteNotes(events);
      detach.push(notes.attach(bus));
      return notes;
    },
    {
      deps: { events: EventBusToken, bus: CommandBusToken },
      dispose: () => detach.splice(0).forEach((unsubscribe) => unsubscribe()),
    },
  );
  container.factory(TemplateSpaceToken, ({ db, store }) => lazyTemplateSpace(container, db, store), {
    deps: { db: LibraryDatabaseToken, store: TemplateStoreToken },
  });
  container.factory(TemplateSearchToken, ({ db, space }) => lazyTemplateSearch(db, space), {
    deps: { db: LibraryDatabaseToken, space: TemplateSpaceToken },
  });
  container.factory(
    TemplateFitterToken,
    ({ db, space, store }) =>
      createTemplateFitter({
        // LRN1-PREF: casting's config with the learned weights, read per fit. The agent root always registers it
        // (agent-casting-prefs.ts); a container built without memory fits with the casting config as it is.
        ...(container.has(CastingConfigSourceToken)
          ? { config: container.resolve(CastingConfigSourceToken) }
          : {}),
        // Fit's own profiles: their vectors come from the space fit awaits, so they are never read before it opens.
        profiles: createShotProfileSource({ db, vectors: () => space.library() }),
        templates: store,
        vectors: async () => {
          const open = await space.current();
          return open
            ? ok(open.vectors)
            : err(
                EmbedderUnavailable(undefined, {
                  detail: 'the jobs process does not serve an embedding space yet',
                }),
              );
        },
      }),
    { deps: { db: LibraryDatabaseToken, space: TemplateSpaceToken, store: TemplateStoreToken } },
  );
  container.factory(TemplateIndexUpkeepToken, ({ space, events }) => keepTemplateIndex(space, events), {
    deps: { space: TemplateSpaceToken, events: EventBusToken },
    dispose: (upkeep) => upkeep.stop(),
  });
}

/** Follows template writes and catches the index up (at the agent's start). */
export function startTemplateIndex(container: Container): void {
  container.resolve(TemplateIndexUpkeepToken);
}

/** LRN1-STY: the template index as style profiles read it (their exemplars), or undefined while no space is open. */
export async function openTemplateIndex(container: Container): Promise<OpenTemplateIndex | undefined> {
  const open = await container.resolve(TemplateSpaceToken).current();
  return open
    ? { index: templateIndexName(open.embedder.space.indexName), vectors: open.vectors }
    : undefined;
}
