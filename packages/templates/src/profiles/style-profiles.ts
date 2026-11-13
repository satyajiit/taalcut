// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Style profiles in the agent process (LRN1-STY): built on demand and kept fresh, with their summaries. A read
 * rebuilds a stale profile first (derived data: the stored one is only a cache); `refresh` and `refreshAll` are
 * what the refresher calls when templates or a watched collection change. Builds of one set never overlap. The
 * summary is written in the background after a build whose profile changed, and announced with `library.changed`
 * (entity 'styleProfile', ids: the set's key) like the build itself.
 */
import {
  err,
  NotFoundError,
  ok,
  styleSourceKey,
  type AsyncResult,
  type BackgroundModels,
  type Clock,
  type EventBus,
  type ProjectId,
  type StyleProfile,
  type StyleProfileRecord,
  type StyleProfileStore,
  type StyleProfileView,
  type StyleSource,
  type StyleProfileSummary,
  type TemplateStore,
} from '@taalcut/core';
import { buildProfile, plannedDigest, type OpenTemplateIndex } from './build-profile';
import { styleProfileJson } from './profile-of';
import { readSheets, viewOf } from './profile-views';
import { writeStyleSummary } from './summary';

export interface StyleProfilesDeps {
  readonly store: StyleProfileStore;
  readonly templates: Pick<TemplateStore, 'get' | 'assetPath'>;
  readonly index: () => Promise<OpenTemplateIndex | undefined>;
  /** The agent's background models (vision); absent: no model can write a summary here. */
  readonly models?: BackgroundModels;
  readonly events?: Pick<EventBus, 'emit'>;
  readonly clock: Pick<Clock, 'now'>;
  readonly log?: (line: string) => void;
}

export type RefreshOutcome = 'built' | 'fresh' | 'removed';

export interface StyleProfiles {
  /** The set's profile as the renderer and the agent see it, rebuilt first when stale. */
  view(source: StyleSource, signal?: AbortSignal): AsyncResult<StyleProfileView>;
  /** Rebuilds the set's profile when its members, their versions or the template index changed. */
  refresh(source: StyleSource, signal?: AbortSignal): AsyncResult<RefreshOutcome>;
  /** Every stored profile refreshed; those whose set is gone removed. */
  refreshAll(signal?: AbortSignal): AsyncResult<number>;
  /** Writes the summary again, in the background: answers at once with the summary `writing`. */
  writeSummary(source: StyleSource): AsyncResult<StyleProfileView>;
  /** The style a project is made like (styleProfile.use), or null. */
  projectView(projectId: ProjectId, signal?: AbortSignal): AsyncResult<StyleProfileView | null>;
  /** Resolves once every summary in flight is written (tests, shutdown). */
  settled(): Promise<void>;
}

/** The service's state: what is being built and written now, per set (by styleSourceKey). */
interface Runs {
  readonly deps: StyleProfilesDeps;
  readonly builds: Map<string, Promise<Awaited<AsyncResult<StyleProfileRecord | null>>>>;
  readonly writing: Map<string, Promise<void>>;
  /** The digest whose summary this process started last, per set: a stored `writing` for another is stale. */
  readonly started: Map<string, string>;
}

/** The run in flight under this key, or a new one, forgotten once it settles. */
function oneAtATime<T>(runs: Map<string, Promise<T>>, key: string, start: () => Promise<T>): Promise<T> {
  const running = runs.get(key);
  if (running) return running;
  const run = start().finally(() => runs.delete(key));
  runs.set(key, run);
  return run;
}

function announce(deps: StyleProfilesDeps, source: StyleSource, change: 'updated' | 'deleted'): void {
  deps.events?.emit('library.changed', {
    projectId: null,
    entity: 'styleProfile',
    change,
    ids: [styleSourceKey(source)],
  });
}

async function summarize(deps: StyleProfilesDeps, record: StyleProfileRecord): Promise<void> {
  const profile = record.profile;
  if (!profile) return;
  const summary: StyleProfileSummary = deps.models
    ? await writeStyleSummary(profile, await readSheets(deps.templates, profile.exemplars, deps.log), {
        models: deps.models,
        now: () => deps.clock.now(),
      })
    : { state: 'none', reason: 'no_model', at: deps.clock.now() };
  const saved = await deps.store.setSummary(record.source, record.digest, summary);
  if (!saved.ok) deps.log?.(`style profile summary not saved: ${saved.error.code}`);
  else if (saved.value) announce(deps, record.source, 'updated');
}

/** Starts the record's summary unless one is being written here already. */
function startSummary(runs: Runs, record: StyleProfileRecord): void {
  const key = styleSourceKey(record.source);
  void oneAtATime(runs.writing, key, () => {
    runs.started.set(key, record.digest);
    return summarize(runs.deps, record);
  });
}

/** A new build's summary: the written one kept when the profile came out the same, else written anew. */
function summaryAfter(
  before: StyleProfileRecord | null,
  profile: StyleProfile | null,
  now: number,
): StyleProfileSummary {
  if (!profile) return { state: 'none', reason: 'empty', at: now };
  if (
    before?.profile &&
    before.summary.state === 'written' &&
    styleProfileJson(before.profile) === styleProfileJson(profile)
  )
    return before.summary;
  return { state: 'writing', at: now };
}

/** The collection or folder is gone: so is its profile. */
async function removeGone(deps: StyleProfilesDeps, source: StyleSource): AsyncResult<null> {
  const removed = await deps.store.remove(source);
  if (!removed.ok) return removed;
  announce(deps, source, 'deleted');
  return ok(null);
}

async function build(
  runs: Runs,
  source: StyleSource,
  signal?: AbortSignal,
): AsyncResult<StyleProfileRecord | null> {
  const { deps } = runs;
  const planned = await plannedDigest(deps, source);
  if (!planned.ok) return NotFoundError.is(planned.error) ? removeGone(deps, source) : planned;
  const stored = await deps.store.get(source);
  if (!stored.ok) return stored;
  if (stored.value?.digest === planned.value.digest) return ok(stored.value);
  const built = await buildProfile(deps, source, signal);
  if (!built.ok) return built;
  const now = deps.clock.now();
  const record: StyleProfileRecord = {
    source,
    digest: built.value.digest,
    profile: built.value.profile,
    summary: summaryAfter(stored.value, built.value.profile, now),
    builtAt: now,
  };
  const put = await deps.store.put(record);
  if (!put.ok) return put;
  announce(deps, source, 'updated');
  if (record.summary.state === 'writing') startSummary(runs, record);
  return ok(record);
}

/** One build per set at a time: a second caller waits for the first and reads what it stored. */
function ensure(
  runs: Runs,
  source: StyleSource,
  signal?: AbortSignal,
): AsyncResult<StyleProfileRecord | null> {
  return oneAtATime(runs.builds, styleSourceKey(source), () => build(runs, source, signal));
}

async function view(runs: Runs, source: StyleSource, signal?: AbortSignal): AsyncResult<StyleProfileView> {
  const record = await ensure(runs, source, signal);
  if (!record.ok) return record;
  if (!record.value) return err(NotFoundError({ entity: 'styleSource', id: styleSourceKey(source) }));
  // A summary left `writing` by an earlier run of the app (it quit mid-way): write it again.
  const { summary, digest } = record.value;
  if (summary.state === 'writing' && runs.started.get(styleSourceKey(source)) !== digest)
    startSummary(runs, record.value);
  const name = await runs.deps.store.sourceName(source);
  if (!name.ok) return name;
  return ok(await viewOf(runs.deps.templates, record.value, name.value));
}

async function refresh(runs: Runs, source: StyleSource, signal?: AbortSignal): AsyncResult<RefreshOutcome> {
  const before = await runs.deps.store.get(source);
  if (!before.ok) return before;
  const after = await ensure(runs, source, signal);
  if (!after.ok) return after;
  if (!after.value) return ok('removed');
  return ok(before.value?.digest === after.value.digest ? 'fresh' : 'built');
}

async function refreshAll(runs: Runs, signal?: AbortSignal): AsyncResult<number> {
  const stamps = await runs.deps.store.list();
  if (!stamps.ok) return stamps;
  let built = 0;
  for (const stamp of stamps.value) {
    if (signal?.aborted) break;
    const after = await ensure(runs, stamp.source, signal);
    if (!after.ok)
      runs.deps.log?.(`style profile ${styleSourceKey(stamp.source)} not refreshed: ${after.error.code}`);
    else if (after.value?.digest !== stamp.digest) built++;
  }
  return ok(built);
}

async function writeSummary(runs: Runs, source: StyleSource): AsyncResult<StyleProfileView> {
  const record = await ensure(runs, source);
  if (!record.ok) return record;
  if (record.value?.profile) {
    const writingNow: StyleProfileRecord = {
      ...record.value,
      summary: { state: 'writing', at: runs.deps.clock.now() },
    };
    const saved = await runs.deps.store.setSummary(source, writingNow.digest, writingNow.summary);
    if (!saved.ok) return saved;
    if (saved.value) announce(runs.deps, source, 'updated');
    startSummary(runs, writingNow);
  }
  return view(runs, source);
}

async function projectView(
  runs: Runs,
  projectId: ProjectId,
  signal?: AbortSignal,
): AsyncResult<StyleProfileView | null> {
  const style = await runs.deps.store.projectStyle(projectId);
  if (!style.ok) return style;
  if (!style.value) return ok(null);
  const found = await view(runs, style.value, signal);
  // The set the project was made like is gone: the project has no style to follow.
  if (!found.ok && NotFoundError.is(found.error)) return ok(null);
  return found;
}

export function createStyleProfiles(deps: StyleProfilesDeps): StyleProfiles {
  const runs: Runs = { deps, builds: new Map(), writing: new Map(), started: new Map() };
  return {
    view: (source, signal) => view(runs, source, signal),
    refresh: (source, signal) => refresh(runs, source, signal),
    refreshAll: (signal) => refreshAll(runs, signal),
    writeSummary: (source) => writeSummary(runs, source),
    projectView: (projectId, signal) => projectView(runs, projectId, signal),
    async settled() {
      while (runs.writing.size > 0) await Promise.all([...runs.writing.values()]);
    },
  };
}
