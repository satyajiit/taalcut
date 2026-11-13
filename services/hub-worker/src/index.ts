// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Worker's composition root. It checks the configuration, builds each request's dependencies and hands the
 * request to the route that matches (routes/*.ts each export theirs). The caches live here, one set per isolate:
 * Workers reuse an isolate across requests and start a new one empty.
 */
import { createExpiringCache } from './cache/expiring-cache';
import { hubConfig, type HubConfig } from './config/env';
import { type HubDeps } from './deps';
import { createInstallationTokens } from './github/app-token';
import { type GitHubPort, type PullState } from './github/github-port';
import { createRestGitHub } from './github/rest-github';
import { fail } from './http/respond';
import { healthRoutes } from './routes/health';
import { ratingRoutes } from './routes/ratings';
import { reportRoutes } from './routes/reports';
import { dispatch, type Route } from './routes/route';
import { submissionRoutes } from './routes/submissions';
import { type HubEnv } from './store/d1';

const ROUTES: readonly Route[] = [...healthRoutes, ...submissionRoutes, ...ratingRoutes, ...reportRoutes];

export interface HubWorkerOptions {
  /** The hub repository client for a configuration. Default: the REST API with the App's installation token. */
  github?: (config: HubConfig) => GitHubPort;
  /** Default: `fetch` (the REST client and the token exchange). */
  fetch?: typeof fetch;
  now?: () => number;
}

export interface HubWorker {
  fetch(request: Request, env: HubEnv): Promise<Response>;
}

export function createHubWorker(options: HubWorkerOptions = {}): HubWorker {
  const now = options.now ?? (() => Date.now());
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const tokens = createInstallationTokens({ fetch: fetchImpl, now, cache: createExpiringCache<string>(4) });
  const states = createExpiringCache<PullState>();
  const hidden = createExpiringCache<ReadonlySet<string>>(1);
  const github =
    options.github ??
    ((config: HubConfig) =>
      createRestGitHub({ repo: config.repo, fetch: fetchImpl, token: () => tokens.token(config.app) }));

  return {
    async fetch(request, env) {
      const config = hubConfig(env);
      if (!config) return fail('hub.not_configured', 503);
      const repository = github(config);
      const deps: HubDeps = {
        db: env.RATINGS,
        submitBurst: env.SUBMIT_BURST,
        rateBurst: env.RATE_BURST,
        readBurst: env.READ_BURST,
        salt: config.salt,
        now,
        github: repository,
        states,
        hidden: { github: repository, cache: hidden, now },
      };
      try {
        return await dispatch(ROUTES, request, deps);
      } catch (error) {
        // A D1 failure or a broken invariant (a bug). The app reads 500 as `hub.busy` and may retry. Only the
        // error's name and the path (ids only) are logged: bodies, install keys and tokens never reach a log line.
        console.error(
          `hub-worker: ${error instanceof Error ? error.name : 'unknown'} in ${request.method} ${new URL(request.url).pathname}`,
        );
        return fail('hub.busy', 500);
      }
    },
  };
}

/** The deployed Worker: one instance (and one set of caches) per isolate. */
const worker: HubWorker = createHubWorker();
export default worker;
