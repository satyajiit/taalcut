// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A validated submission (docs/template-hub.md section 4): limits → dedupe → owner → branch, file, pull request.
 * GitHub failures are 503 `hub.github_unavailable` (retryable); a branch left without a pull request is reused on
 * the retry. The install's HMAC is the owner; the raw key never gets this far.
 */
import { type HubProblem, type HubTemplateV0, hubSubmissionResponseSchema } from '@taalcut/core/hub';
import { type z } from 'zod';

import { type ExpiringCache } from '../cache/expiring-cache';
import { type GitHubPort, type GitHubResult, type PullState } from '../github/github-port';
import { newUlid } from '../ids/ulid';
import { takeSubmit, type LimitRefusal } from '../limits/rate-limits';
import { claimOwner } from '../store/d1-owners';
import {
  findByOwnerHash,
  insertSubmission,
  maxVersion,
  openSubmissions,
  setSubmissionState,
  type SubmissionRow,
} from '../store/d1-submissions';
import { type D1Database, type RateLimitBinding } from '../store/d1';
import { canonicalTemplate, templateSha256 } from './canonical';

export interface SubmitDeps {
  db: D1Database;
  submitBurst: RateLimitBinding;
  github: GitHubPort;
  now: () => number;
  states: ExpiringCache<PullState>;
}

type SubmissionResponse = z.output<typeof hubSubmissionResponseSchema>;

export type SubmitResult =
  | { status: 202; body: SubmissionResponse }
  | { status: 400; body: { code: 'hub.invalid'; problems: HubProblem[] } }
  | { status: 409; body: { code: 'hub.not_owner' } }
  | { status: 429; body: LimitRefusal }
  | { status: 503; body: { code: 'hub.github_unavailable' } };

export async function submit(deps: SubmitDeps, hmac: string, template: HubTemplateV0): Promise<SubmitResult> {
  const limit = await takeSubmit(deps.db, deps.submitBurst, hmac, deps.now());
  if (!limit.ok) return { status: 429, body: limit };

  const text = canonicalTemplate(template);
  const sha256 = await templateSha256(text);
  const existing = await findByOwnerHash(deps.db, hmac, sha256);
  if (existing) return { status: 202, body: responseOf(existing) };

  const owner = await claimOwner(deps.db, template.id, hmac);
  if (owner !== hmac) return { status: 409, body: { code: 'hub.not_owner' } };

  const latest = await maxVersion(deps.db, template.id, hmac);
  if (latest !== null && template.version !== latest + 1) {
    return { status: 400, body: { code: 'hub.invalid', problems: [{ path: 'version', rule: 'schema' }] } };
  }

  const previous = await openSubmissions(deps.db, template.id);
  const pull = await openPull(deps.github, template, text);
  if (!pull.ok) return { status: 503, body: { code: 'hub.github_unavailable' } };
  const row: SubmissionRow = {
    id: newUlid(deps.now()),
    hub_id: template.id,
    owner: hmac,
    sha256,
    version: template.version,
    pull_request: pull.value,
    state: 'open',
    created_at: deps.now(),
  };
  await insertSubmission(deps.db, row);
  await supersede(deps, previous);
  return { status: 202, body: responseOf(row) };
}

/** Branch `submit/<hubId>-v<version>` from main, the file `templates/<2 chars>/<hubId>.json`, the pull request. */
async function openPull(
  github: GitHubPort,
  template: HubTemplateV0,
  text: string,
): Promise<GitHubResult<number>> {
  const branch = `submit/${template.id}-v${template.version}`;
  const created = await github.createBranch(branch, 'main');
  if (!created.ok) return created;
  const path = `templates/${template.id.slice(0, 2)}/${template.id}.json`;
  const put = await github.putFile(path, text, branch, `Template ${template.id} version ${template.version}`);
  if (!put.ok) return put;
  const pull = await github.openPullRequest({
    title: `Template: ${template.name} by ${template.handle}`,
    body: pullBody(template.handle),
    head: branch,
    base: 'main',
    labels: ['submission', 'via-app'],
  });
  return pull.ok ? { ok: true, value: pull.value.number } : pull;
}

function responseOf(row: SubmissionRow): SubmissionResponse {
  return hubSubmissionResponseSchema.parse({
    submissionId: row.id,
    hubId: row.hub_id,
    version: row.version,
    state: row.state,
    pullRequest: row.pull_request,
  });
}

function pullBody(handle: string): string {
  return [
    'This template is dedicated under CC0-1.0.',
    'Anyone can use, change and share it, without asking or giving credit.',
    `Handle: ${handle}`,
    'The Worker validated the document against hub template v0 and the content rules.',
  ].join('\n');
}

/**
 * Closes the pull requests a newer version replaces. One that won't close stays `open` in D1, so the next
 * submission of this template tries it again; the new pull request is already open either way.
 */
async function supersede(deps: SubmitDeps, previous: { id: string; pull_request: number }[]): Promise<void> {
  for (const row of previous) {
    const closed = await deps.github.closePullRequest(row.pull_request, 'Superseded by a newer submission.');
    if (!closed.ok) continue;
    await setSubmissionState(deps.db, row.id, 'closed');
    deps.states.delete(row.id);
  }
}
