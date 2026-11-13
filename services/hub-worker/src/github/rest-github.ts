// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';

import { bytesToBase64 } from '../encoding/bytes';
import { type GitHubPort, type GitHubResult, type PullState } from './github-port';
import { createRestCall, isStatus, type RestCallOptions } from './rest-call';

export interface RestGitHubOptions extends RestCallOptions {
  repo: string;
}

const refBody = z.object({ object: z.object({ sha: z.string().min(1) }) });
const contentBody = z.object({ sha: z.string().min(1) });
const numberBody = z.object({ number: z.int().positive() });
const pullBody = z.object({ state: z.enum(['open', 'closed']), merged: z.boolean() });
/** A call whose answer body nothing reads. */
const discardBody = z.unknown().transform(() => null);

/** GitHubPort over REST. Tests pass a fake `fetch`; nothing here calls the network unless that fetch does. */
export function createRestGitHub(options: RestGitHubOptions): GitHubPort {
  const repo = `/repos/${options.repo}`;
  const call = createRestCall(options);

  async function refSha(name: string): Promise<GitHubResult<string>> {
    const ref = await call('GET', `${repo}/git/ref/heads/${refPath(name)}`, { shape: refBody });
    return ref.ok ? { ok: true, value: ref.value.object.sha } : ref;
  }

  return {
    async createBranch(name, fromRef) {
      const base = await refSha(fromRef);
      if (!base.ok) return base;
      const created = await call('POST', `${repo}/git/refs`, {
        body: { ref: `refs/heads/${name}`, sha: base.value },
        shape: discardBody,
      });
      // 422: the branch is there from an earlier attempt, which is reused.
      if (!created.ok && !isStatus(created, 422)) return created;
      const branch = await refSha(name);
      return branch.ok ? { ok: true, value: { sha: branch.value } } : branch;
    },

    async putFile(path, content, branch, message) {
      const url = `${repo}/contents/${refPath(path)}`;
      const body = { message, content: bytesToBase64(new TextEncoder().encode(content)), branch };
      const put = await call('PUT', url, { body, shape: discardBody });
      // 409 or 422: the file is on the branch already (a retry); replacing it needs its blob sha.
      if (put.ok || !isStatus(put, 409, 422)) return put;
      const existing = await call('GET', `${url}?ref=${encodeURIComponent(branch)}`, { shape: contentBody });
      if (!existing.ok) return existing;
      return call('PUT', url, { body: { ...body, sha: existing.value.sha }, shape: discardBody });
    },

    async openPullRequest(input) {
      const created = await call('POST', `${repo}/pulls`, {
        body: { title: input.title, body: input.body, head: input.head, base: input.base },
        shape: numberBody,
      });
      if (!created.ok) return created;
      const labelled = await call('POST', `${repo}/issues/${created.value.number}/labels`, {
        body: { labels: input.labels },
        shape: discardBody,
      });
      return labelled.ok ? { ok: true, value: { number: created.value.number } } : labelled;
    },

    async pullRequestState(number) {
      const pull = await call('GET', `${repo}/pulls/${number}`, { shape: pullBody });
      if (!pull.ok) return pull;
      const state: PullState = pull.value.merged ? 'merged' : pull.value.state;
      return { ok: true, value: state };
    },

    async closePullRequest(number, comment) {
      const commented = await call('POST', `${repo}/issues/${number}/comments`, {
        body: { body: comment },
        shape: discardBody,
      });
      if (!commented.ok) return commented;
      return call('PATCH', `${repo}/pulls/${number}`, { body: { state: 'closed' }, shape: discardBody });
    },

    async openIssue(input) {
      const created = await call('POST', `${repo}/issues`, {
        body: { title: input.title, body: input.body, labels: input.labels },
        shape: numberBody,
      });
      return created.ok ? { ok: true, value: { number: created.value.number } } : created;
    },

    commentIssue: (number, body) =>
      call('POST', `${repo}/issues/${number}/comments`, { body: { body }, shape: discardBody }),

    async readFile(path, ref) {
      const file = await call('GET', `${repo}/contents/${refPath(path)}?ref=${encodeURIComponent(ref)}`, {
        shape: z.string(),
        raw: true,
      });
      return isStatus(file, 404) ? { ok: true, value: null } : file;
    },
  };
}

function refPath(path: string): string {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}
