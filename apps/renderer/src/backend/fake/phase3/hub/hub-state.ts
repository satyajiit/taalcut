// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fake hub's state (P3-B12): the cached index and its files, the ratings table, this install's ratings, forks
 * and submissions, and the gates every hub call passes as @taalcut/templates' client does: Local only first, then
 * a build without hub addresses; the Worker and file fetches also fail offline (the cached index still browses).
 */
import {
  err,
  HubNotConfigured,
  HubOffline,
  HubRateLimited,
  LocalOnly,
  ok,
  type HubIndexEntry,
  type HubRating,
  type HubSubmissionView,
  type HubTemplateId,
  type HubTemplateV0,
  type Result,
  type TemplateId,
} from '@taalcut/core';
import { fakeUlid } from '../../library/seed';
import { GOLDEN_HOUR, templateIdOf } from '../../templates/template-data';
import type { Phase3Deps } from '../phase3-deps';
import { HIDDEN_SEED, FUTURE_FORMAT_SEED } from './hub-seed-data';
import { hubIdOf, seedHub } from './hub-seed';

export interface FakeHubOptions {
  /** This build's hub state: the default is configured and online. */
  readonly state?: 'online' | 'notConfigured' | 'localOnly' | 'offline';
  /** The Worker answers every publish, rating and report with hub.rate_limited. */
  readonly rateLimited?: boolean;
  /** A submission of "Golden hour market" (version 2) in this state, for the template page. */
  readonly submission?: HubSubmissionView['state'];
}

/** How many of each the Worker takes from one install in a session before it says hub.rate_limited. */
export const LIMITS = { publish: 5, rate: 30, report: 10 } as const;
const RETRY_AFTER_SECONDS = 720;
/** fakeUlid's kind for submission ids (18: 'J'). */
export const SUBMISSION_KIND = 18;

export type HubFile =
  | { readonly kind: 'ok'; readonly document: HubTemplateV0 }
  | { readonly kind: 'hidden' }
  | { readonly kind: 'newer'; readonly formatVersion: number };

export interface HubState {
  readonly entries: HubIndexEntry[];
  readonly files: Map<HubTemplateId, HubFile>;
  readonly ratings: Map<HubTemplateId, HubRating>;
  /** Every rating this install sent, for the Worker's mean (and the detail page's "your rating"). */
  readonly mine: Map<HubTemplateId, number>;
  readonly forks: Map<HubTemplateId, TemplateId>;
  readonly submissions: HubSubmissionView[];
  readonly sent: Record<keyof typeof LIMITS, number>;
  /** The CC0 acknowledgements publish recorded (HUB_LICENCE_TERMS), with the template each was for. */
  readonly acknowledgements: { readonly templateId: TemplateId; readonly at: number }[];
  readonly indexFetchedAt: number | null;
}

export function createHubState(now: number, options: FakeHubOptions): HubState {
  const seeded = seedHub(now);
  const files = new Map<HubTemplateId, HubFile>();
  for (const [id, document] of seeded.documents) files.set(id, { kind: 'ok', document });
  files.set(hubIdOf(HIDDEN_SEED), { kind: 'hidden' });
  files.set(hubIdOf(FUTURE_FORMAT_SEED), { kind: 'newer', formatVersion: 1 });
  const configured = options.state !== 'notConfigured';
  return {
    entries: configured ? seeded.entries : [],
    files,
    ratings: seeded.ratings,
    mine: new Map(),
    forks: new Map(),
    submissions: options.submission
      ? [
          {
            id: fakeUlid<'HubSubmission'>(SUBMISSION_KIND, 1),
            hubId: hubIdOf(900),
            version: 1,
            templateId: templateIdOf(GOLDEN_HOUR),
            templateVersion: 2,
            state: options.submission,
            createdAt: now - 2 * 86_400_000,
            checkedAt: now - 3_600_000,
          },
        ]
      : [],
    sent: { publish: 0, rate: 0, report: 0 },
    acknowledgements: [],
    // The index is fetched hourly; offline, the last one is three hours old.
    indexFetchedAt: configured ? now - (options.state === 'offline' ? 3 * 3_600_000 : 4 * 60_000) : null,
  };
}

/** Local only, then a build without hub addresses (hub-service.ts `blocked`). */
export function blocked(deps: Pick<Phase3Deps, 'localOnly'>, options: FakeHubOptions): Result<void> {
  if (deps.localOnly() || options.state === 'localOnly') return err(LocalOnly({ what: 'hub' }));
  if (options.state === 'notConfigured') return err(HubNotConfigured());
  return ok(undefined);
}

/** A request to the Worker or a file: blocked, then offline (fetch-transport.ts). */
export function reach(deps: Pick<Phase3Deps, 'localOnly'>, options: FakeHubOptions): Result<void> {
  const gate = blocked(deps, options);
  if (!gate.ok) return gate;
  return options.state === 'offline' ? err(HubOffline()) : ok(undefined);
}

/** The Worker's limit on one kind of request. */
export function limit(state: HubState, options: FakeHubOptions, kind: keyof typeof LIMITS): Result<void> {
  if (options.rateLimited || state.sent[kind] >= LIMITS[kind])
    return err(HubRateLimited({ retryAfterSeconds: RETRY_AFTER_SECONDS }));
  state.sent[kind] += 1;
  return ok(undefined);
}
