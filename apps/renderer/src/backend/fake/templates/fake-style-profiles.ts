// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fake's style profiles (LRN1-STY), as packages/templates' StyleProfiles serves them: a set's members are the
 * templates linked to a Saved collection's reels (all_saved: every saved reel), filed in a folder or tagged so, or
 * behind a ready export (the make fakes' renders, through `exportedTemplates`), unarchived; a render's change
 * announces my exports again, as the service's refresher does after it rebuilds. A set with members answers the ui's sample numbers
 * (the renderer can't run profileOf) over those members, its first three as the exemplars; an empty one answers
 * no profile. templates.writeStyleSummary marks the summary writing, announces it, and half a second later writes
 * it, each change announced with `library.changed` (entity 'styleProfile', ids: the set's key) as the service does.
 *
 * Scenarios (`taalcut.fake` → `styleProfiles`): 'local' (the default: written on this Mac), 'cloud' (by a cloud
 * model allowed to see pictures), 'noModel' (no model, honestly, and still none after Try again), 'notYet' (the
 * model is getting ready; Try again writes it), 'failed' (the last try failed; Try again writes it), 'writing'
 * (being written, for the spinner), 'slow' (every read waits 30 s, for the bones), 'failing' (reads fail: the
 * section's error).
 */
import {
  appContract,
  implementContract,
  NotFoundError,
  styleSourceKey,
  TimeoutError,
  toRpcError,
  type EventBus,
  type Id,
  type StyleExemplar,
  type StyleProfileSummary,
  type StyleProfileView,
  type StyleSource,
  type TemplateSummary,
} from '@taalcut/core';
import { STYLE_PROFILE_SAMPLE, STYLE_SUMMARY_SAMPLE } from '@taalcut/ui';
import type { FakeInstagramSaved } from './fake-instagram-saved';
import type { FakeTemplates } from './fake-templates';

export const FAKE_STYLE_PROFILE_SCENARIOS = [
  'local',
  'cloud',
  'noModel',
  'notYet',
  'failed',
  'writing',
  'slow',
  'failing',
] as const;
export type FakeStyleProfileScenario = (typeof FAKE_STYLE_PROFILE_SCENARIOS)[number];

export interface FakeStyleProfilesOptions {
  readonly scenario?: FakeStyleProfileScenario;
}

export interface FakeStyleProfilesDeps {
  readonly events: EventBus;
  readonly templates: FakeTemplates;
  readonly instagram: Pick<FakeInstagramSaved, 'listCollections' | 'listReels'>;
  readonly folderName: (folderId: Id<'TemplateFolder'>) => string | null;
  /** The templates behind a ready export (the make fakes'); none without them. */
  readonly exportedTemplates: () => readonly Id<'Template'>[];
  readonly options?: FakeStyleProfilesOptions | undefined;
}

const PROCEDURES = {
  styleProfile: appContract.templates.styleProfile,
  writeStyleSummary: appContract.templates.writeStyleSummary,
};

/** How long a summary takes to write, and a slow read. */
const WRITE_MS = 500;
const SLOW_MS = 30_000;
const LOCAL = { provider: 'on-device', model: 'qwen3.5-4b' } as const;
const CLOUD = { provider: 'google', model: 'gemini-3.1-flash-lite' } as const;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function written(where: 'local' | 'cloud', at: number): StyleProfileSummary {
  const by = where === 'local' ? LOCAL : CLOUD;
  return { state: 'written', text: STYLE_SUMMARY_SAMPLE, ...by, local: where === 'local', at };
}

/** A set's summary before anything asks again, by scenario. */
function firstSummary(scenario: FakeStyleProfileScenario, at: number): StyleProfileSummary {
  switch (scenario) {
    case 'cloud':
      return written('cloud', at);
    case 'noModel':
      return { state: 'none', reason: 'no_model', at };
    case 'notYet':
      return { state: 'none', reason: 'not_yet', at };
    case 'failed':
      return {
        state: 'failed',
        error: {
          code: 'templates.style_summary_empty',
          messageKey: 'errors.templates.style_summary_empty',
          params: { model: LOCAL.model },
          retryable: true,
        },
        at,
      };
    case 'writing':
      return { state: 'writing', at };
    case 'local':
    case 'slow':
    case 'failing':
      return written('local', at);
  }
}

/** What a summary becomes once written again: still none without a model, else written where the scenario says. */
function rewritten(scenario: FakeStyleProfileScenario, at: number): StyleProfileSummary {
  return scenario === 'noModel'
    ? { state: 'none', reason: 'no_model', at }
    : written(scenario === 'cloud' ? 'cloud' : 'local', at);
}

function exemplarOf(summary: TemplateSummary): StyleExemplar {
  return {
    templateId: summary.id,
    version: summary.head,
    name: summary.name,
    contactSheet: summary.contactSheet,
    duration: summary.duration,
    slotCount: summary.slotCount,
  };
}

/** A set as the fake knows it: its name and its members, newest first. */
interface FakeSet {
  readonly name: string | null;
  readonly members: readonly TemplateSummary[];
}

/** A Saved collection's set: the unarchived templates its reels link to (all_saved: every reel's); null when gone. */
function collectionSet(deps: FakeStyleProfilesDeps, collectionId: string): FakeSet | null {
  const collection = deps.instagram.listCollections().find((item) => item.id === collectionId);
  if (!collection) return null;
  const reels = deps.instagram.listReels({ collectionId, onlyUnlinked: false, limit: 200 }).items;
  const ids = new Set(reels.flatMap((reel) => (reel.templateId ? [reel.templateId] : [])));
  const members = [...ids].flatMap((id) => {
    const summary = deps.templates.summary(id);
    return summary && !summary.archived ? [summary] : [];
  });
  return { name: collection.name, members };
}

/** The set's name and members; null when the set doesn't exist. */
function setOf(deps: FakeStyleProfilesDeps, source: StyleSource): FakeSet | null {
  const unarchived = () => deps.templates.summaries().filter((item) => !item.archived);
  switch (source.kind) {
    case 'instagram-collection':
      return collectionSet(deps, source.collectionId);
    case 'folder': {
      const name = deps.folderName(source.folderId);
      return name === null
        ? null
        : { name, members: unarchived().filter((item) => item.folderId === source.folderId) };
    }
    case 'tag':
      return { name: source.tag, members: unarchived().filter((item) => item.tags.includes(source.tag)) };
    case 'my-exports': {
      const exported = new Set(deps.exportedTemplates());
      return { name: null, members: unarchived().filter((item) => exported.has(item.id)) };
    }
  }
}

/** A set's view: ui's sample numbers over its members, the first three as exemplars; no profile when it's empty. */
function viewOf(
  source: StyleSource,
  set: FakeSet,
  summary: StyleProfileSummary,
  builtAt: number,
): StyleProfileView {
  if (set.members.length === 0)
    return {
      source,
      name: set.name,
      profile: null,
      summary: { state: 'none', reason: 'empty', at: builtAt },
      exemplars: [],
      builtAt: null,
    };
  const exemplars = set.members.slice(0, 3).map(exemplarOf);
  return {
    source,
    name: set.name,
    profile: {
      ...STYLE_PROFILE_SAMPLE,
      members: set.members.length,
      exemplars: exemplars.map((item) => ({ id: item.templateId, version: item.version })),
      exemplarPool: set.members.length,
    },
    summary,
    exemplars,
    builtAt,
  };
}

export function createFakeStyleProfiles(deps: FakeStyleProfilesDeps) {
  const scenario = deps.options?.scenario ?? 'local';
  const summaries = new Map<string, StyleProfileSummary>();
  const builtAt = Date.now();

  function current(source: StyleSource): StyleProfileView {
    const set = setOf(deps, source);
    if (!set) throw toRpcError(NotFoundError({ entity: 'styleSource', id: styleSourceKey(source) }));
    const summary = summaries.get(styleSourceKey(source)) ?? firstSummary(scenario, builtAt);
    return viewOf(source, set, summary, builtAt);
  }

  const announce = (source: StyleSource) =>
    deps.events.emit('library.changed', {
      projectId: null,
      entity: 'styleProfile',
      change: 'updated',
      ids: [styleSourceKey(source)],
    });
  deps.events.on('library.changed', ({ payload }) => {
    if (payload.entity === 'render') announce({ kind: 'my-exports' });
  });

  async function read(source: StyleSource): Promise<StyleProfileView> {
    if (scenario === 'slow') await wait(SLOW_MS);
    if (scenario === 'failing') throw toRpcError(TimeoutError({ ms: 30_000 }));
    return current(source);
  }

  function writeSummary(source: StyleSource): StyleProfileView {
    if (!current(source).profile) return current(source);
    const key = styleSourceKey(source);
    summaries.set(key, { state: 'writing', at: Date.now() });
    announce(source);
    setTimeout(() => {
      summaries.set(key, rewritten(scenario, Date.now()));
      announce(source);
    }, WRITE_MS);
    return current(source);
  }

  const tpl = implementContract(PROCEDURES);
  return {
    router: {
      styleProfile: tpl.styleProfile.handler(({ input }) => read(input.source)),
      writeStyleSummary: tpl.writeStyleSummary.handler(({ input }) => writeSummary(input.source)),
    },
  };
}
