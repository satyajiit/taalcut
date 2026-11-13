// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  type HubProblem,
  hubContentProblems,
  hubSubmissionRequestSchema,
  hubSubmissionResponseSchema,
  hubSubmissionStateSchema,
} from '@taalcut/core/hub';

import { type HubDeps } from '../deps';
import { isRecord, zodProblems } from '../http/json';
import { readJsonBody } from '../http/read-body';
import { fail, githubUnavailable, invalid, json, unreadable } from '../http/respond';
import { installHash } from '../identity/install-hash';
import { clientIp, takeRead } from '../limits/rate-limits';
import { hiddenIds } from '../moderation/hidden-ids';
import { findById, setSubmissionState } from '../store/d1-submissions';
import { submit } from '../submissions/submit';
import { type Route } from './route';

/** Five minutes, as docs/template-hub.md section 4 says. */
const STATE_TTL_MS = 5 * 60 * 1000;

/**
 * POST /v0/submissions: size, JSON, the request schema, then core's hubContentProblems on the template as sent
 * (every key and string at every depth), so the Worker refuses exactly what the app's share check and the hub's
 * CI refuse. Schema problems come from the request schema, so the content check's own are not repeated.
 */
async function post(request: Request, deps: HubDeps): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return unreadable(body);
  const parsed = hubSubmissionRequestSchema.safeParse(body.value);
  const problems: HubProblem[] = parsed.success ? [] : zodProblems(parsed.error).map(inTemplate);
  if (isRecord(body.value) && 'template' in body.value) {
    problems.push(...hubContentProblems(body.value.template).filter((problem) => problem.rule !== 'schema'));
  }
  if (problems.length > 0) return invalid(problems);
  if (!parsed.success) return invalid([{ path: '', rule: 'schema' }]);

  const hmac = await installHash(deps.salt, parsed.data.installKey);
  const result = await submit(
    { db: deps.db, submitBurst: deps.submitBurst, github: deps.github, now: deps.now, states: deps.states },
    hmac,
    parsed.data.template,
  );
  return json(result.body, result.status);
}

/** A template's problems carry paths inside the template, as the content check's do and the app's share check reads. */
function inTemplate(problem: HubProblem): HubProblem {
  return problem.path === 'template' || problem.path.startsWith('template.')
    ? { ...problem, path: problem.path.slice('template.'.length) }
    : problem;
}

/** GET /v0/submissions/:id: hidden (the hub repository's list), else the pull request's state, cached. */
async function get(request: Request, deps: HubDeps, id: string): Promise<Response> {
  const limit = await takeRead(deps.readBurst, clientIp(request));
  if (!limit.ok) return fail(limit.code, 429, { retryAfterSeconds: limit.retryAfterSeconds });
  if (!hubSubmissionResponseSchema.shape.submissionId.safeParse(id).success)
    return fail('hub.not_found', 404);
  const row = await findById(deps.db, id);
  if (!row) return fail('hub.not_found', 404);
  const hidden = await hiddenIds(deps.hidden);
  if (!hidden.ok) return githubUnavailable();
  if (hidden.value.has(row.hub_id)) return json(hubSubmissionStateSchema.parse({ state: 'hidden' }), 200);
  const now = deps.now();
  const cached = deps.states.get(id, now);
  if (cached) return json(hubSubmissionStateSchema.parse({ state: cached }), 200);
  const state = await deps.github.pullRequestState(row.pull_request);
  if (!state.ok) return githubUnavailable();
  await setSubmissionState(deps.db, id, state.value);
  deps.states.set(id, state.value, now + STATE_TTL_MS);
  return json(hubSubmissionStateSchema.parse({ state: state.value }), 200);
}

export const submissionRoutes: readonly Route[] = [
  { method: 'POST', path: /^\/v0\/submissions$/, handle: post },
  { method: 'GET', path: /^\/v0\/submissions\/([^/]+)$/, handle: get },
];
