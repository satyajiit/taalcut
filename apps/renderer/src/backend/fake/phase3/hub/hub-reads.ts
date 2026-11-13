// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.hub's reads over the fake hub's state, as hub-service.ts and hub-browse.ts answer them: status
 * always; browse and get blocked by Local only, then by a build without hub addresses; get also needs the file
 * (offline, hidden, a newer format); the share check reads the template and this install's last submission.
 */
import {
  err,
  HubHidden,
  HubNotFound,
  HubOffline,
  HubUnsupportedFormat,
  newId,
  NotFoundError,
  NotImplementedError,
  ok,
  RationalTime,
  ValidationError,
  type AsyncResult,
  type HubBrowseItem,
  type HubBrowsePage,
  type HubBrowseQuery,
  type HubIndexEntry,
  type HubShareForm,
  type HubSort,
  type HubStatus,
  type HubSubmissionView,
  type HubTemplateDetail,
  type HubTemplateId,
  type ShareCheck,
  type TemplateId,
} from '@taalcut/core';
import type { Phase3Deps } from '../phase3-deps';
import { shareCheckOf } from './hub-convert';
import { blocked, reach, type FakeHubOptions, type HubState } from './hub-state';

type Deps = Pick<Phase3Deps, 'localOnly' | 'templates' | 'now'>;

function matches(entry: HubIndexEntry, query: HubBrowseQuery): boolean {
  if (query.language !== undefined && entry.language !== query.language) return false;
  if (query.formatId !== undefined && entry.formatId !== query.formatId) return false;
  if (query.maxSeconds !== undefined && RationalTime.toSeconds(entry.duration) > query.maxSeconds)
    return false;
  if (query.tags !== undefined && !query.tags.every((tag) => entry.tags.includes(tag))) return false;
  const needle = query.query?.trim().toLowerCase() ?? '';
  if (!needle) return true;
  return [entry.name, entry.description, entry.handle, ...entry.tags]
    .join('\n')
    .toLowerCase()
    .includes(needle);
}

const byId = (a: HubIndexEntry, b: HubIndexEntry) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const newest = (a: HubIndexEntry, b: HubIndexEntry) =>
  b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || byId(a, b);

function freshest(a: HubIndexEntry, b: HubIndexEntry): number {
  if (a.trendFreshness === b.trendFreshness) return newest(a, b);
  if (a.trendFreshness === null) return 1;
  if (b.trendFreshness === null) return -1;
  return a.trendFreshness < b.trendFreshness ? 1 : -1;
}

function ranking(state: HubState, sort: HubSort) {
  if (sort === 'newest') return newest;
  if (sort === 'freshest') return freshest;
  const mean = (entry: HubIndexEntry) => state.ratings.get(entry.id)?.mean ?? -1;
  const count = (entry: HubIndexEntry) => state.ratings.get(entry.id)?.count ?? -1;
  return (a: HubIndexEntry, b: HubIndexEntry) => mean(b) - mean(a) || count(b) - count(a) || newest(a, b);
}

/** This install's fork, while it is still in the library (Undo removes it). */
async function forkedAs(state: HubState, deps: Deps, hubId: HubTemplateId): Promise<TemplateId | null> {
  const templateId = state.forks.get(hubId);
  if (!templateId) return null;
  if (await deps.templates.get(templateId)) return templateId;
  state.forks.delete(hubId);
  return null;
}

async function itemOf(state: HubState, deps: Deps, entry: HubIndexEntry): Promise<HubBrowseItem> {
  return {
    ...entry,
    rating: state.ratings.get(entry.id) ?? null,
    forkedAs: await forkedAs(state, deps, entry.id),
  };
}

export function hubStatus(state: HubState, deps: Deps, options: FakeHubOptions): HubStatus {
  return {
    configured: options.state !== 'notConfigured',
    localOnly: deps.localOnly() || options.state === 'localOnly',
    indexFetchedAt: state.indexFetchedAt,
    templates: state.entries.length,
  };
}

export async function hubBrowse(
  state: HubState,
  deps: Deps,
  options: FakeHubOptions,
  query: HubBrowseQuery,
): AsyncResult<HubBrowsePage> {
  const gate = blocked(deps, options);
  if (!gate.ok) return gate;
  const start = query.cursor === undefined || query.cursor === '' ? 0 : Number(query.cursor);
  if (!Number.isInteger(start) || start < 0) return err(ValidationError({ field: 'cursor' }));
  const ranked = state.entries.filter((entry) => matches(entry, query)).sort(ranking(state, query.sort));
  const items = await Promise.all(
    ranked.slice(start, start + query.limit).map((entry) => itemOf(state, deps, entry)),
  );
  const next = start + query.limit;
  return ok({ items, nextCursor: next < ranked.length ? String(next) : null });
}

export async function hubGet(
  state: HubState,
  deps: Deps,
  options: FakeHubOptions,
  hubId: HubTemplateId,
): AsyncResult<HubTemplateDetail> {
  const gate = blocked(deps, options);
  if (!gate.ok) return gate;
  const entry = state.entries.find((item) => item.id === hubId);
  if (!entry) return err(HubNotFound());
  // The file comes from the hub, not the cache: offline it can't be read.
  if (options.state === 'offline') return err(HubOffline());
  const file = state.files.get(hubId);
  if (!file) return err(HubNotFound());
  if (file.kind === 'hidden') return err(HubHidden());
  if (file.kind === 'newer') return err(HubUnsupportedFormat({ formatVersion: file.formatVersion }));
  return ok({
    item: await itemOf(state, deps, entry),
    document: file.document,
    myRating: state.mine.get(hubId) ?? null,
  });
}

export async function hubShareCheck(
  state: HubState,
  deps: Deps,
  input: { readonly templateId: TemplateId; readonly version: number; readonly form: HubShareForm },
): AsyncResult<ShareCheck> {
  const got = await deps.templates.get(input.templateId, input.version);
  if (!got) return err(NotFoundError({ entity: 'template', id: input.templateId }));
  // No Style store reaches the fake hub: sharing a look is what the real client says without one.
  if (input.form.includeStyle && got.template.styleId !== null)
    return err(NotImplementedError({ feature: 'styles' }));
  const latest = state.submissions.filter((item) => item.templateId === input.templateId).at(-1);
  const origin = got.summary.provenance;
  return ok(
    shareCheckOf(
      got.template,
      {
        hubId: latest?.hubId ?? newId<'HubTemplate'>(),
        version: latest ? latest.version + 1 : 1,
        forkedFrom: origin?.kind === 'hub' ? { id: origin.hubId, version: origin.version } : null,
      },
      input.form,
      deps.now(),
    ),
  );
}

/** This install's submissions; `refresh` asks the Worker for each one's state (the fake's never move on). */
export async function hubSubmissions(
  state: HubState,
  deps: Deps,
  options: FakeHubOptions,
  input: { readonly templateId?: TemplateId | undefined; readonly refresh: boolean },
): AsyncResult<HubSubmissionView[]> {
  const listed = state.submissions.filter(
    (item) => input.templateId === undefined || item.templateId === input.templateId,
  );
  if (!input.refresh) return ok(listed);
  const gate = reach(deps, options);
  // Offline, each keeps its last state and checkedAt, as the real client does for a read that fails.
  if (!gate.ok) return gate.error.code === 'hub.offline' ? ok(listed) : gate;
  const checkedAt = deps.now();
  return ok(
    listed.map((item) => {
      const updated = { ...item, checkedAt };
      state.submissions.splice(state.submissions.indexOf(item), 1, updated);
      return updated;
    }),
  );
}
