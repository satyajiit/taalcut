// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type ExpiringCache } from './cache/expiring-cache';
import { type GitHubPort, type PullState } from './github/github-port';
import { type HiddenDeps } from './moderation/hidden-ids';
import { type D1Database, type RateLimitBinding } from './store/d1';

/** What a route gets: this request's bindings and checked configuration, and the isolate's caches. */
export interface HubDeps {
  db: D1Database;
  submitBurst: RateLimitBinding;
  rateBurst: RateLimitBinding;
  readBurst: RateLimitBinding;
  /** INSTALL_ID_SALT, the HMAC key of install hashes. */
  salt: string;
  now: () => number;
  github: GitHubPort;
  /** Pull request states, five minutes, by submission id. */
  states: ExpiringCache<PullState>;
  hidden: HiddenDeps;
}
