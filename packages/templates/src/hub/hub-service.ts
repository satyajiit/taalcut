// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.hub (P3-B12, P3-V8): status, browse, one template, the share check and this install's
 * submissions. Writes are the hub commands.
 */
import {
  err,
  HubNotConfigured,
  HubNotFound,
  LocalOnly,
  NotImplementedError,
  ok,
  ValidationError,
  type AsyncResult,
  type Clock,
  type HubBrowsePage,
  type HubBrowseQuery,
  type HubService,
  type HubShareForm,
  type HubSubmissionStore,
  type HubSubmissionView,
  type HubTemplateDetail,
  type HubTemplateId,
  type Result,
  type ShareCheck,
  type Style,
  type StyleId,
  type TemplatesService,
} from '@taalcut/core';
import type { HubEndpoints } from './endpoints';
import { browseItem, browsePage, type ForkedTemplate } from './hub-browse';
import type { HubIds } from './from-hub';
import type { HubIndexClient, RatingsTable } from './index-cache';
import type { HubTransport } from './hub-transport';
import type { MyRatings } from './my-ratings';
import { readHubDocument } from './read-document';
import { shareCheck } from './share-check';

export interface HubServiceDeps {
  readonly endpoints: HubEndpoints | null;
  readonly localOnly: () => boolean;
  readonly transport: HubTransport;
  readonly index: HubIndexClient;
  readonly templates: Pick<TemplatesService, 'get'>;
  readonly submissions: HubSubmissionStore;
  readonly clock: Clock;
  readonly ids: HubIds;
  readonly newHubTemplateId: () => HubTemplateId;
  readonly myRatings: MyRatings;
  /** This install's fork of a hub id, if the library can tell. Absent: forkedAs is null. */
  readonly forkedTemplate?: ForkedTemplate;
  /** Absent until the Style store is registered: sharing a look is then core.not_implemented. */
  readonly styleOf?: (styleId: StyleId) => AsyncResult<Style | null>;
}

type ShareCheckRequest = Parameters<HubService['shareCheck']>[0];

/** Local only, then a build without hub addresses: nothing is fetched. */
function blocked(deps: HubServiceDeps): Result<void> {
  if (deps.localOnly()) return err(LocalOnly({ what: 'hub' }));
  if (!deps.endpoints) return err(HubNotConfigured());
  return ok(undefined);
}

async function ratings(deps: HubServiceDeps): AsyncResult<RatingsTable> {
  const loaded = await deps.index.loadRatings();
  return loaded.ok ? ok(loaded.value ?? {}) : loaded;
}

async function styleFor(
  deps: HubServiceDeps,
  styleId: StyleId | null,
  form: HubShareForm,
): AsyncResult<Style | null> {
  if (!form.includeStyle || styleId === null) return ok(null);
  if (!deps.styleOf) return err(NotImplementedError({ feature: 'styles' }));
  return deps.styleOf(styleId);
}

async function checkShare(deps: HubServiceDeps, input: ShareCheckRequest): AsyncResult<ShareCheck> {
  const got = await deps.templates.get({ templateId: input.templateId, version: input.version });
  if (!got.ok) return got;
  const style = await styleFor(deps, got.value.template.styleId, input.form);
  if (!style.ok) return style;
  const latest = await deps.submissions.latestFor(input.templateId);
  if (!latest.ok) return latest;
  const origin = got.value.summary.provenance;
  return ok(
    shareCheck({
      template: got.value.template,
      meta: {
        name: input.form.name,
        // An update keeps the hub id this install shared the lineage under.
        hubId: latest.value?.hubId ?? deps.newHubTemplateId(),
        version: latest.value ? latest.value.version + 1 : 1,
        provenance:
          origin?.kind === 'hub' ? { kind: 'hub', hubId: origin.hubId, version: origin.version } : null,
      },
      form: input.form,
      style: style.value,
      ids: deps.ids,
      now: deps.clock.now(),
    }),
  );
}

/** Each open submission's state from the Worker; one that can't be read keeps its last state and checkedAt. */
async function refreshed(
  deps: HubServiceDeps,
  listed: readonly HubSubmissionView[],
): AsyncResult<HubSubmissionView[]> {
  const views: HubSubmissionView[] = [];
  for (const item of listed) {
    const state = await deps.transport.submission(item.id);
    if (!state.ok) {
      if (LocalOnly.is(state.error) || HubNotConfigured.is(state.error)) return state;
      views.push(item);
      continue;
    }
    const checkedAt = deps.clock.now();
    const saved = await deps.submissions.setState(item.id, state.value.state, checkedAt);
    if (!saved.ok) return saved;
    views.push({ ...item, state: state.value.state, checkedAt });
  }
  return ok(views);
}

async function browse(deps: HubServiceDeps, query: HubBrowseQuery): AsyncResult<HubBrowsePage> {
  const gate = blocked(deps);
  if (!gate.ok) return gate;
  const start = query.cursor === undefined || query.cursor === '' ? 0 : Number(query.cursor);
  if (!Number.isInteger(start) || start < 0) return err(ValidationError({ field: 'cursor' }));
  const loaded = await deps.index.loadIndex();
  if (!loaded.ok) return loaded;
  const table = await ratings(deps);
  if (!table.ok) return table;
  return browsePage(loaded.value.index.templates, query, start, table.value, deps.forkedTemplate);
}

async function detail(deps: HubServiceDeps, hubId: HubTemplateId): AsyncResult<HubTemplateDetail> {
  const gate = blocked(deps);
  if (!gate.ok) return gate;
  const loaded = await deps.index.loadIndex();
  if (!loaded.ok) return loaded;
  const listed = loaded.value.index.templates.find((item) => item.id === hubId);
  if (!listed) return err(HubNotFound());
  const document = await readHubDocument(
    { transport: deps.transport, loadIndex: (options) => deps.index.loadIndex(options) },
    hubId,
    { version: listed.version, sha256: listed.sha256 },
  );
  if (!document.ok) return document;
  // A hash mismatch refreshes the index: the row then describes the version that was read.
  const fresh = await deps.index.loadIndex();
  if (!fresh.ok) return fresh;
  const entry = fresh.value.index.templates.find((item) => item.id === hubId) ?? listed;
  const table = await ratings(deps);
  if (!table.ok) return table;
  const item = await browseItem(entry, table.value, deps.forkedTemplate);
  if (!item.ok) return item;
  const mine = await deps.myRatings.get(hubId);
  if (!mine.ok) return mine;
  return ok({ item: item.value, document: document.value.document, myRating: mine.value });
}

export function createHubService(deps: HubServiceDeps): HubService {
  return {
    async status() {
      const cached = await deps.index.cachedIndex();
      if (!cached.ok) return cached;
      return ok({
        configured: deps.endpoints !== null,
        localOnly: deps.localOnly(),
        indexFetchedAt: cached.value?.fetchedAt ?? null,
        templates: cached.value?.index.templates.length ?? 0,
      });
    },
    browse: (query) => browse(deps, query),
    get: (hubId) => detail(deps, hubId),
    shareCheck: (input) => checkShare(deps, input),
    async submissions(input) {
      const listed = await deps.submissions.list(
        input.templateId !== undefined ? { templateId: input.templateId } : {},
      );
      if (!listed.ok || !input.refresh) return listed;
      const gate = blocked(deps);
      return gate.ok ? refreshed(deps, listed.value) : gate;
    },
  };
}
