// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  hubIdSchema,
  hubRatingRequestSchema,
  hubRatingsSchema,
  hubWithdrawRatingSchema,
} from '@taalcut/core/hub';
import { type z } from 'zod';

import { type HubDeps } from '../deps';
import { readJsonBody } from '../http/read-body';
import { invalid, json, unreadable } from '../http/respond';
import { installHash } from '../identity/install-hash';
import { listRatings, putRating, withdrawRating, type RatingDeps } from '../ratings/ratings';
import { type Route } from './route';

const ratingDeps = (deps: HubDeps): RatingDeps => ({
  db: deps.db,
  rateBurst: deps.rateBurst,
  now: deps.now,
  hidden: deps.hidden,
});

/** A rating request's hub id and body, checked, and the install's hash; or the refusal to send. */
async function rateRequest<T extends { installKey: string }>(
  request: Request,
  deps: HubDeps,
  hubId: string,
  schema: z.ZodType<T>,
): Promise<{ body: T; hmac: string } | Response> {
  if (!hubIdSchema.safeParse(hubId).success) return invalid([{ path: 'hubId', rule: 'schema' }]);
  const read = await readJsonBody(request);
  if (!read.ok) return unreadable(read);
  const parsed = schema.safeParse(read.value);
  if (!parsed.success) return invalid([{ path: '', rule: 'schema' }]);
  return { body: parsed.data, hmac: await installHash(deps.salt, parsed.data.installKey) };
}

/** PUT /v0/ratings/:hubId `{ installKey, stars }`. */
async function put(request: Request, deps: HubDeps, hubId: string): Promise<Response> {
  const checked = await rateRequest(request, deps, hubId, hubRatingRequestSchema);
  if (checked instanceof Response) return checked;
  const result = await putRating(ratingDeps(deps), hubId, checked.hmac, checked.body.stars);
  return json(result.body, result.status);
}

/** DELETE /v0/ratings/:hubId `{ installKey }`. */
async function withdraw(request: Request, deps: HubDeps, hubId: string): Promise<Response> {
  const checked = await rateRequest(request, deps, hubId, hubWithdrawRatingSchema);
  if (checked instanceof Response) return checked;
  const result = await withdrawRating(ratingDeps(deps), hubId, checked.hmac);
  return json(result.body, result.status);
}

/** GET /v0/ratings, cached at the edge for ten minutes. */
async function list(_request: Request, deps: HubDeps): Promise<Response> {
  const result = await listRatings(ratingDeps(deps));
  if (result.status !== 200) return json(result.body, result.status);
  return json(hubRatingsSchema.parse(result.body), 200, { 'cache-control': 'public, max-age=600' });
}

const ONE = /^\/v0\/ratings\/([^/]+)$/;

export const ratingRoutes: readonly Route[] = [
  { method: 'GET', path: /^\/v0\/ratings$/, handle: list },
  { method: 'PUT', path: ONE, handle: put },
  { method: 'DELETE', path: ONE, handle: withdraw },
];
