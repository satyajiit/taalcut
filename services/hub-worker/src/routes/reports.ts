// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { hubReportRequestSchema } from '@taalcut/core/hub';

import { type HubDeps } from '../deps';
import { zodProblems } from '../http/json';
import { readJsonBody } from '../http/read-body';
import { invalid, json, unreadable } from '../http/respond';
import { installHash } from '../identity/install-hash';
import { reportTemplate } from '../reports/report';
import { type Route } from './route';

/** POST /v0/reports `{ installKey, hubId, reason, note? }`. */
async function post(request: Request, deps: HubDeps): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return unreadable(body);
  const parsed = hubReportRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalid(zodProblems(parsed.error));
  const hmac = await installHash(deps.salt, parsed.data.installKey);
  const result = await reportTemplate(
    { db: deps.db, github: deps.github, now: deps.now },
    { hmac, hubId: parsed.data.hubId, reason: parsed.data.reason, note: parsed.data.note },
  );
  return json(result.body, result.status);
}

export const reportRoutes: readonly Route[] = [{ method: 'POST', path: /^\/v0\/reports$/, handle: post }];
