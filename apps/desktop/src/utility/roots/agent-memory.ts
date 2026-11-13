// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Agent memory in the agent process (LRN1-MEM, packages/agent SPEC section 33): the library's memory store and
 * commands on the agent's bus, the memory index in the active embedding space (opened once the jobs process serves
 * it, then kept in step with every committed change), the ranker recall and `memory.recall` read, Settings →
 * Memory's service, and "what worked" from main's render.finished.
 *
 * Joins agent-launch.ts (deps, tools, commands) and agent-root.ts (router, start) with one line each.
 */
import {
  callRpc,
  ClockToken,
  CommandBusToken,
  createToken,
  embedderOverRpc,
  EventBusToken,
  EventLogStoreToken,
  MEMORY_CLOUD_PROMPTS_SETTING,
  MEMORY_COMMANDS,
  memoryIndexName,
  MemoryIndexToken,
  memoryRouter,
  MemoryStoreToken,
  MODEL_MODULE_IDS,
  RenderStoreToken,
  SettingsStoreToken,
  StyleStoreToken,
  TemplateStoreToken,
  TimelineStoreToken,
  ok,
  type AnyCommand,
  type AsyncResult,
  type Container,
  type Embedder,
  type ModelModuleId,
  type ProjectId,
  type TemplateId,
  type ToolModule,
  type VectorIndex,
} from '@taalcut/core';
import {
  createMemoryService,
  productMemoryContext,
  createWhatWorkedRecorder,
  fromCoreEventLog,
  memoryRunFacts,
  memoryToolModule,
  renderFacts,
  type MemoryRecallDeps,
  type PrivacyMemory,
  type WhatWorkedRecorder,
} from '@taalcut/agent';
import {
  createMemoryCommands,
  createMemoryIndexer,
  createMemoryRanker,
  createMemoryStore,
  memoryScopeName,
  openVectorIndex,
  type MemoryCommands,
  type MemoryIndexer,
  type MemoryRanker,
} from '@taalcut/library';
import { moduleNetworks } from '@taalcut/models';
import {
  AgentMainServicesToken,
  LibraryDatabaseToken,
  LibraryPortsToken,
  ModelProfilesToken,
  ModelRuntimeToken,
} from '../../shared/tokens';
import { SkillRegistryToken } from './agent-flows';
import { followMainExports, type ExportsFollower } from './agent-memory-exports';
import { moduleContextWindow } from './model-windows';
import { ProductStoreToken } from '../products/tokens';

const MemoryCommandsToken = createToken<MemoryCommands>('desktop.memoryCommands');
const MemoryRankerToken = createToken<MemoryRanker>('desktop.memoryRanker');
const WhatWorkedToken = createToken<WhatWorkedRecorder>('desktop.whatWorked');
/** The memory index in the active space, opened on first ask (null until the jobs process serves the space). */
const MemorySpaceToken = createToken<() => Promise<MemorySpace | null>>('desktop.memorySpace');
const ExportsFollowerToken = createToken<ExportsFollower>('desktop.memoryExports');

/** How often an unopened space is asked for again (library search and casting wait as long). */
const SPACE_RETRY_MS = 30_000;
/** Templates a project's recall takes from its timelines, newest first (recall keeps 3 in all). */
const PROJECT_TEMPLATES = 3;

interface MemorySpace {
  readonly index: VectorIndex;
  readonly embedder: Embedder;
  readonly indexer: MemoryIndexer;
}

const isModule = (module: string): module is ModelModuleId =>
  (MODEL_MODULE_IDS as readonly string[]).includes(module);

/**
 * The memory index in the active space, opened the first time it is asked for once the jobs process serves the
 * space. Opening it reconciles it with the store (a new space fills itself) and follows every later change.
 */
function lazyMemorySpace(container: Container): () => Promise<MemorySpace | null> {
  let active: MemorySpace | null = null;
  let lastTry = Number.NEGATIVE_INFINITY;
  let pending: Promise<MemorySpace | null> | undefined;

  async function open(): Promise<MemorySpace | null> {
    if (!container.has(AgentMainServicesToken)) return null;
    const main = container.resolve(AgentMainServicesToken);
    const space = await callRpc(main().embeddings.space());
    // Until the embedding model is served (vision, P2-L9), recall ranks by words and recency.
    if (!space.ok) return null;
    const db = container.resolve(LibraryDatabaseToken);
    const index = openVectorIndex(db, {
      name: memoryIndexName(space.value.indexName),
      dimensions: space.value.dimensions,
    });
    if (!index.ok) {
      console.warn(`[memory] index not opened: ${index.error.code}`);
      return null;
    }
    const embedder = embedderOverRpc(() => main().embeddings, space.value);
    const indexer = createMemoryIndexer({ db, index: index.value, embedder });
    indexer.follow(container.resolve(EventBusToken));
    if (!container.has(MemoryIndexToken)) container.value(MemoryIndexToken, index.value);
    void indexer.reconcile().then((done) => {
      if (!done.ok) console.warn(`[memory] index not reconciled: ${done.error.code}`);
    });
    return { index: index.value, embedder, indexer };
  }

  return async () => {
    if (active || Date.now() - lastTry < SPACE_RETRY_MS) return active;
    lastTry = Date.now();
    pending ??= open().finally(() => (pending = undefined));
    active = await pending;
    return active;
  };
}

/** Whether a prompt to this module may leave the Mac now: its chain has a cloud model (Local only aside). */
function leavesDevice(container: Container): (module: ModelModuleId) => boolean {
  const profiles = container.resolve(ModelProfilesToken);
  const runtime = container.resolve(ModelRuntimeToken);
  return (module) => {
    const plan = moduleNetworks({ selector: profiles, runtime, localOnly: false }).find(
      (m) => m.module === module,
    );
    return plan?.runsOn === 'cloud' || plan?.runsOn === 'both';
  };
}

/** The modules a run's prompts go to: the agent's and each skill's. */
function promptModules(container: Container): readonly ModelModuleId[] {
  const skills = container.has(SkillRegistryToken) ? container.resolve(SkillRegistryToken).list() : [];
  return [...new Set(['agent', ...skills.map((skill) => skill.module ?? 'agent')])].filter(isModule);
}

/** The templates the project's timelines are made from, newest first. */
function projectTemplates(
  container: Container,
): (projectId: ProjectId) => AsyncResult<readonly TemplateId[]> {
  return async (projectId) => {
    const listed = await container.resolve(TimelineStoreToken).listByProject(projectId);
    if (!listed.ok) return listed;
    const ids = [...listed.value]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .flatMap((timeline) => (timeline.template ? [timeline.template.id] : []));
    return ok([...new Set(ids)].slice(0, PROJECT_TEMPLATES));
  };
}

export function registerAgentMemory(container: Container): void {
  container.factory(
    MemoryStoreToken,
    ({ db, ports }) => createMemoryStore(db, { commands: ports.commands }),
    { deps: { db: LibraryDatabaseToken, ports: LibraryPortsToken } },
  );
  container.factory(
    MemoryCommandsToken,
    ({ store, settings, clock }) => createMemoryCommands({ store, settings, clock }),
    { deps: { store: MemoryStoreToken, settings: SettingsStoreToken, clock: ClockToken } },
  );
  container.value(MemorySpaceToken, lazyMemorySpace(container));
  container.factory(MemoryRankerToken, ({ store, space }) => createMemoryRanker({ store, space }), {
    deps: { store: MemoryStoreToken, space: MemorySpaceToken },
  });
  container.factory(
    WhatWorkedToken,
    ({ store, settings, renders, timelines, templates }) =>
      createWhatWorkedRecorder({
        facts: (renderId) =>
          renderFacts(
            {
              renders,
              timelines,
              templates,
              ...(container.has(StyleStoreToken) ? { styles: container.resolve(StyleStoreToken) } : {}),
            },
            renderId,
          ),
        store,
        commands: container.resolve(CommandBusToken),
        settings,
        renders,
      }),
    {
      deps: {
        store: MemoryStoreToken,
        settings: SettingsStoreToken,
        renders: RenderStoreToken,
        timelines: TimelineStoreToken,
        templates: TemplateStoreToken,
      },
    },
  );
}

/** createAgent's `phase3.memory`: recall once per run, over the ranker, the cloud switch and the module plans. */
export function memoryAgentDeps(container: Container): { readonly memory?: MemoryRecallDeps } {
  if (!container.has(MemoryRankerToken)) return {};
  const settings = container.resolve(SettingsStoreToken);
  return {
    memory: {
      ranker: container.resolve(MemoryRankerToken),
      cloudPrompts: () => settings.get(MEMORY_CLOUD_PROMPTS_SETTING),
      leavesDevice: leavesDevice(container),
      projectTemplates: projectTemplates(container),
      ...(container.has(ProductStoreToken)
        ? { productContext: productMemoryContext(container.resolve(ProductStoreToken)) }
        : {}),
      // LRN1-CTX: the smallest window a prompt to each module may go to (model-windows.ts).
      contextWindow: moduleContextWindow(container),
    },
  };
}

/** memory.remember (its card names the project or template from the library) and memory.recall. */
export function memoryToolModules(container: Container): ToolModule[] {
  if (!container.has(MemoryRankerToken)) return [];
  const log = fromCoreEventLog(container.resolve(EventLogStoreToken));
  const db = container.resolve(LibraryDatabaseToken);
  return [
    memoryToolModule({
      ranker: container.resolve(MemoryRankerToken),
      run: memoryRunFacts(log),
      scopeName: async (scope) => memoryScopeName(db, scope),
    }),
  ];
}

/** createPrivacyService's `memory`: Settings → Privacy lists memory where Settings → Memory says it goes. */
export function memoryPrivacy(container: Container): PrivacyMemory {
  const settings = container.resolve(SettingsStoreToken);
  return {
    cloudPrompts: () => settings.get(MEMORY_CLOUD_PROMPTS_SETTING),
    modules: () => promptModules(container),
  };
}

/** The cloud switch changes what Settings → Privacy lists. */
export const notifiesMemoryPrivacy = (name: string) => name === MEMORY_COMMANDS.setCloudPrompts;

/** MEMORY_COMMANDS, announcing each committed change on the agent's events (the index and windows follow). */
export function memoryCommands(container: Container): AnyCommand[] {
  if (!container.has(MemoryCommandsToken)) return [];
  const commands = container.resolve(MemoryCommandsToken);
  commands.announce(container.resolve(CommandBusToken), container.resolve(EventBusToken));
  return commands.all;
}

/** appContract.memory: Settings → Memory's list and status line. */
export function agentMemoryRouter(container: Container) {
  const profiles = container.resolve(ModelProfilesToken);
  const runtime = container.resolve(ModelRuntimeToken);
  return memoryRouter(
    createMemoryService({
      store: container.resolve(MemoryStoreToken),
      settings: container.resolve(SettingsStoreToken),
      // The same plans Settings → Privacy shows (agent-services.ts), so the two pages agree.
      modules: (localOnly) => moduleNetworks({ selector: profiles, runtime, localOnly }),
      promptModules: () => promptModules(container),
    }),
  );
}

/**
 * At start: open the memory space (so the index is reconciled before the first run asks), catch up on exports that
 * finished while the agent wasn't listening, then follow main's. The follower stops with the container.
 */
export async function startAgentMemory(container: Container): Promise<void> {
  void container.resolve(MemorySpaceToken)();
  const recorder = container.resolve(WhatWorkedToken);
  const caught = await recorder.catchUp();
  if (!caught.ok) console.warn(`[memory] exports not caught up: ${caught.error.code}`);
  if (!container.has(AgentMainServicesToken)) return;
  const main = container.resolve(AgentMainServicesToken);
  container.factory(ExportsFollowerToken, () => followMainExports(main, recorder), {
    dispose: (follower) => follower.stop(),
  });
  container.resolve(ExportsFollowerToken);
}
