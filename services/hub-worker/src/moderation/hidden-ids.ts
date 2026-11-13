// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which templates a maintainer has hidden (P3-V8, docs/template-hub.md section 5): the hub repository's
 * `moderation/hidden.json` on `main`, which `moderate.yml` writes when the `hidden` label is added or removed. It
 * is the one source of truth, so the Worker reads it rather than keeping a copy: a hidden template's ratings drop
 * out of the aggregate, new ratings are refused (`hub.hidden`) and its submissions read as hidden. The list is
 * cached for five minutes per isolate; when a refresh fails, the last list read is used, and with none the
 * failure is the answer.
 */
import { hubIdSchema } from '@taalcut/core/hub';
import { z } from 'zod';

import { type ExpiringCache } from '../cache/expiring-cache';
import { jsonValue } from '../encoding/json-text';
import { type GitHubPort, type GitHubResult } from '../github/github-port';

export const HIDDEN_FILE = 'moderation/hidden.json';
export const HIDDEN_TTL_MS = 5 * 60 * 1000;
const KEY = 'hidden';

/** `[{ hubId, reason, issue, at }]`; the Worker needs the ids only. */
const hiddenList = z.array(z.object({ hubId: hubIdSchema }));

export interface HiddenDeps {
  github: GitHubPort;
  cache: ExpiringCache<ReadonlySet<string>>;
  now: () => number;
}

export async function hiddenIds(deps: HiddenDeps): Promise<GitHubResult<ReadonlySet<string>>> {
  const now = deps.now();
  const fresh = deps.cache.get(KEY, now);
  if (fresh) return { ok: true, value: fresh };
  const read = await readHidden(deps.github);
  if (read.ok) {
    deps.cache.set(KEY, read.value, now + HIDDEN_TTL_MS);
    return read;
  }
  const last = deps.cache.last(KEY);
  return last ? { ok: true, value: last } : read;
}

async function readHidden(github: GitHubPort): Promise<GitHubResult<ReadonlySet<string>>> {
  const file = await github.readFile(HIDDEN_FILE, 'main');
  if (!file.ok) return file;
  if (file.value === null) return { ok: true, value: new Set() };
  const parsed = hiddenList.safeParse(jsonValue(file.value));
  if (!parsed.success) return { ok: false, failure: { kind: 'shape', what: HIDDEN_FILE } };
  return { ok: true, value: new Set(parsed.data.map((row) => row.hubId)) };
}
