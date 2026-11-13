// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings → Memory's backend in the preview (LRN1-MEM): appContract.memory (`list`, `status`) and MEMORY_COMMANDS
 * as @taalcut/library and the agent's memory service answer them. Commands are app-wide; only a person writes a
 * `user` item; update names the revision it read (core.conflict otherwise; a redo runs again); update's and
 * delete's inverse is the internal memory.restore with the whole previous item; the cloud switch is a person's,
 * with no inverse. Each committed change emits `library.changed` (entity 'memory'), as the agent's bus does.
 *
 * A project or template scope names one the Make and template fakes hold (core.not_found otherwise), and the list
 * joins its name from them, as the library joins its tables.
 *
 * Scenarios (`taalcut.fake` → `memory`): 'empty' (nothing remembered), 'slow' (every read waits 1.5 s, for the
 * bones), 'failing' (list fails: the page's error), 'withheld' (the agent's model is in the cloud and the switch
 * is off), 'local' (the agent works on this Mac).
 * LRN1-PREF: 'casting' adds the casting weights Taalcut learned (casting-weights-seed.ts) to the seeded items, and an
 * update is checked as the library checks it (core's memoryItemProblems: weights inside their bounds).
 */
import {
  appContract,
  ConflictError,
  defineCommand,
  err,
  implementContract,
  MEMORY_CLOUD_PROMPTS_SETTING,
  MEMORY_COMMANDS,
  memoryCommandPayloads,
  memoryItemProblems,
  MemorySourceRefused,
  NotFoundError,
  ok,
  PERSON_SOURCES,
  TimeoutError,
  toRpcError,
  ValidationError,
  type AnyCommand,
  type CommandContext,
  type EventBus,
  type MemoryItem,
  type MemoryItemView,
  type MemoryPromptUse,
  type MemoryScope,
  type ProjectId,
  type MemoryStatus,
  type Result,
  type SettingsStore,
} from '@taalcut/core';
import { castingWeightsSeed } from './casting-weights-seed';
import { memorySeed } from './memory-seed';

export type FakeMemoryScenario = 'empty' | 'slow' | 'failing' | 'withheld' | 'local' | 'casting';
export const FAKE_MEMORY_SCENARIOS: readonly FakeMemoryScenario[] = [
  'empty',
  'slow',
  'failing',
  'withheld',
  'local',
  'casting',
];

export interface FakeMemoryOptions {
  readonly scenario?: FakeMemoryScenario;
}

export interface FakeMemoryDeps {
  readonly now: () => number;
  readonly settings: SettingsStore;
  readonly events: EventBus;
  readonly localOnly: () => boolean;
  /** The Make fakes' projects and the template fakes' summaries: what a scope may name. */
  readonly projects: { get(projectId: ProjectId): { readonly name: string } | null };
  readonly templates: { summaries(): readonly { readonly id: string; readonly name: string }[] };
}

const N = MEMORY_COMMANDS;
const P = memoryCommandPayloads;
const APP_WIDE = { projectId: null } as const;
const SLOW_MS = 1_500;

const isPerson = (context: CommandContext) => (PERSON_SOURCES as readonly string[]).includes(context.source);

/** The scope's name; core.not_found when its project or template isn't there (the library's memoryScopeName). */
function nameOfScope(
  deps: Pick<FakeMemoryDeps, 'projects' | 'templates'>,
  scope: MemoryScope,
): Result<string | null> {
  if (scope.kind === 'user') return ok(null);
  if (scope.kind === 'project') {
    const project = deps.projects.get(scope.projectId);
    return project ? ok(project.name) : err(NotFoundError({ entity: 'project', id: scope.projectId }));
  }
  const template = deps.templates.summaries().find((summary) => summary.id === scope.templateId);
  return template ? ok(template.name) : err(NotFoundError({ entity: 'template', id: scope.templateId }));
}

/** LRN1-PREF: the 'casting' scenario's learned casting weights, beside the seeded items. */
function seedCastingWeights(
  items: Map<string, MemoryItem>,
  scenario: FakeMemoryScenario | undefined,
  now: number,
) {
  if (scenario !== 'casting') return;
  for (const item of castingWeightsSeed(now)) items.set(item.id, item);
}

/** LRN1-PREF: an item the library would refuse (core's memoryItemProblems), as a validation error. */
function itemRefused(item: MemoryItem): Result<void> {
  const problem = memoryItemProblems(item)[0];
  return problem ? err(ValidationError({ field: 'memory' }, { detail: problem })) : ok(undefined);
}

export function createFakeMemory(deps: FakeMemoryDeps, options: FakeMemoryOptions = {}) {
  const scenario = options.scenario;
  const items = new Map<string, MemoryItem>(
    scenario === 'empty' ? [] : memorySeed(deps.now()).map((item) => [item.id, item]),
  );
  if (scenario === 'withheld') void deps.settings.set(MEMORY_CLOUD_PROMPTS_SETTING, false);
  seedCastingWeights(items, scenario, deps.now());

  const scopeName = (scope: MemoryScope) => nameOfScope(deps, scope);
  const view = (item: MemoryItem): MemoryItemView => {
    const named = scopeName(item.scope);
    return { ...item, scopeName: named.ok ? named.value : null };
  };
  const changed = (change: 'created' | 'updated' | 'deleted', id: string) =>
    deps.events.emit('library.changed', { projectId: null, entity: 'memory', change, ids: [id] });
  const mayWrite = (context: CommandContext, item: Pick<MemoryItem, 'source'>): Result<void> =>
    item.source === 'user' && !isPerson(context)
      ? err(MemorySourceRefused({ source: item.source }))
      : ok(undefined);
  const current = (id: string): Result<MemoryItem> => {
    const found = items.get(id);
    return found ? ok(found) : err(NotFoundError({ entity: 'memory', id }));
  };
  const wait = () => (scenario === 'slow' ? new Promise((resolve) => setTimeout(resolve, SLOW_MS)) : null);

  /** Newest first; a query keeps items with every word's prefix somewhere in them, as FTS5 ranks them first. */
  const list = (input: { query?: string; scope?: MemoryItem['scope']['kind'] }) => {
    const words = (text: string) =>
      text
        .normalize('NFC')
        .toLowerCase()
        .split(/[^\p{L}\p{N}\p{M}]+/u)
        .filter(Boolean);
    const terms = input.query ? words(input.query) : [];
    const matches = (item: MemoryItem) =>
      terms.length === 0 || terms.some((term) => words(item.text).some((word) => word.startsWith(term)));
    const found = [...items.values()]
      .filter((item) => (!input.scope || item.scope.kind === input.scope) && matches(item))
      .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1));
    const total = input.query
      ? found.length
      : [...items.values()].filter((item) => !input.scope || item.scope.kind === input.scope).length;
    return { items: found.map(view), total };
  };

  const status = async (): Promise<MemoryStatus> => {
    const cloudPrompts = await deps.settings.get(MEMORY_CLOUD_PROMPTS_SETTING);
    const allowed = cloudPrompts.ok ? cloudPrompts.value : false;
    const localOnly = deps.localOnly();
    const onMac = localOnly || scenario === 'local';
    const prompts: MemoryPromptUse = onMac ? 'on-device' : allowed ? 'cloud' : 'withheld';
    const count = (kind: MemoryItem['scope']['kind']) =>
      [...items.values()].filter((item) => item.scope.kind === kind).length;
    return {
      cloudPrompts: allowed,
      localOnly,
      runsOn: onMac ? 'this-mac' : 'cloud',
      providers: onMac ? [] : ['anthropic'],
      prompts,
      counts: { user: count('user'), project: count('project'), template: count('template') },
    };
  };

  const create = defineCommand({
    name: N.create,
    payload: P[N.create],
    sideEffect: 'write',
    handle: ({ memoryId, item }, context) => {
      const allowed = mayWrite(context, item);
      if (!allowed.ok) return allowed;
      if (items.has(memoryId)) return err(ConflictError({ entity: 'memory', id: memoryId }));
      const named = scopeName(item.scope);
      if (!named.ok) return named;
      const now = deps.now();
      items.set(memoryId, {
        id: memoryId,
        ...item,
        data: item.data ?? null,
        conversationId: item.conversationId ?? null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
      changed('created', memoryId);
      return ok({
        result: { memoryId, revision: 1 },
        inverse: { name: N.remove, payload: { ...APP_WIDE, memoryId } },
      });
    },
  });

  const update = defineCommand({
    name: N.update,
    payload: P[N.update],
    sideEffect: 'write',
    handle: ({ memoryId, baseRevision, patch }, context) => {
      const before = current(memoryId);
      if (!before.ok) return before;
      const allowed = mayWrite(context, before.value);
      if (!allowed.ok) return allowed;
      if (context.replay !== 'redo' && before.value.revision !== baseRevision)
        return err(ConflictError({ entity: 'memory', id: memoryId }));
      const named = patch.scope ? scopeName(patch.scope) : ok(null);
      if (!named.ok) return named;
      const next = { ...before.value, ...patch, revision: before.value.revision + 1, updatedAt: deps.now() };
      const valid = itemRefused(next);
      if (!valid.ok) return valid;
      items.set(memoryId, next);
      changed('updated', memoryId);
      return ok({
        result: { memoryId, revision: next.revision },
        inverse: { name: N.restore, payload: { ...APP_WIDE, memoryId, item: before.value } },
      });
    },
  });

  const remove = defineCommand({
    name: N.remove,
    payload: P[N.remove],
    sideEffect: 'write',
    handle: ({ memoryId }, context) => {
      const before = current(memoryId);
      if (!before.ok) return before;
      const allowed = mayWrite(context, before.value);
      if (!allowed.ok) return allowed;
      items.delete(memoryId);
      changed('deleted', memoryId);
      return ok({
        result: { memoryId },
        inverse: { name: N.restore, payload: { ...APP_WIDE, memoryId, item: before.value } },
      });
    },
  });

  const restore = defineCommand({
    name: N.restore,
    payload: P[N.restore],
    sideEffect: 'write',
    internal: true,
    handle: ({ memoryId, item }) => {
      const before = items.get(memoryId);
      if (item === null) {
        if (items.delete(memoryId)) changed('deleted', memoryId);
        return ok({ result: { memoryId } });
      }
      const revision = before ? before.revision + 1 : item.revision;
      items.set(memoryId, { ...item, revision });
      changed(before ? 'updated' : 'created', memoryId);
      return ok({ result: { memoryId, revision } });
    },
  });

  const setCloudPrompts = defineCommand({
    name: N.setCloudPrompts,
    payload: P[N.setCloudPrompts],
    sideEffect: 'write',
    sources: PERSON_SOURCES,
    handle: async ({ enabled }, context) => {
      const saved = await deps.settings.set(MEMORY_CLOUD_PROMPTS_SETTING, enabled, context);
      return saved.ok ? ok({ result: { enabled } }) : saved;
    },
  });

  const os = implementContract(appContract.memory);
  const router = os.router({
    list: os.list.handler(async ({ input }) => {
      await wait();
      if (scenario === 'failing') throw toRpcError(TimeoutError({ ms: 30_000 }));
      return list(input);
    }),
    status: os.status.handler(async () => {
      await wait();
      return status();
    }),
  });

  const commands: AnyCommand[] = [create, update, remove, restore, setCloudPrompts];
  return { router, commands, items };
}

export type FakeMemory = ReturnType<typeof createFakeMemory>;
