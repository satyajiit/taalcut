// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { createRestGitHub } from '../src/github/rest-github';

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const PULL = fixture('github-pull.json');
const MERGED = fixture('github-pull-merged.json');
const BRANCH = 'submit/01ARZ3NDEKTSV4RRFFQ69G5FAV-v1';

interface Seen {
  method: string;
  url: string;
  authorization: string | null;
  accept: string | null;
  version: string | null;
  body: unknown;
}

/** A recorded-response fetch: `answer` maps a call to a fixture, anything else is a 500. */
function recorded(answer: (method: string, url: string) => Response | undefined) {
  const seen: Seen[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    seen.push({
      method,
      url,
      authorization: headers.get('authorization'),
      accept: headers.get('accept'),
      version: headers.get('x-github-api-version'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return answer(method, url) ?? new Response('missing fixture', { status: 500 });
  };
  const github = createRestGitHub({
    repo: 'taalcut/hub',
    token: async () => ({ ok: true, value: 'ghs_test_not_a_real_token' }),
    fetch: fetchImpl,
  });
  return { github, seen };
}

const json = (text: string, status = 200) =>
  new Response(text, { status, headers: { 'content-type': 'application/json' } });
const ref = (sha: string) => json(JSON.stringify({ object: { sha } }));

describe('rest github', () => {
  it('opens a pull request from the recorded fixtures', async () => {
    const { github, seen } = recorded((method, url) => {
      if (url.endsWith('/git/ref/heads/main')) return ref('b'.repeat(40));
      if (url.endsWith('/git/refs')) return json('{}', 201);
      if (url.includes('/git/ref/heads/submit/')) return ref('c'.repeat(40));
      if (url.includes('/contents/') && method === 'PUT') return json('{"content":{}}', 201);
      if (url.endsWith('/pulls') && method === 'POST') return json(PULL, 201);
      if (url.endsWith('/labels')) return json('[]');
      return undefined;
    });
    expect(await github.createBranch(BRANCH, 'main')).toEqual({ ok: true, value: { sha: 'c'.repeat(40) } });
    expect(
      await github.putFile('templates/01/01ARZ3NDEKTSV4RRFFQ69G5FAV.json', '{}\n', BRANCH, 'Add'),
    ).toEqual({
      ok: true,
      value: null,
    });
    const opened = await github.openPullRequest({
      title: 'Template: Weekend trip by ada',
      body: 'CC0-1.0',
      head: BRANCH,
      base: 'main',
      labels: ['submission', 'via-app'],
    });
    expect(opened).toEqual({ ok: true, value: { number: 17 } });
    expect(seen.every((call) => call.authorization === 'Bearer ghs_test_not_a_real_token')).toBe(true);
    expect(seen.every((call) => call.version === '2026-03-10')).toBe(true);
    expect(seen.every((call) => call.url.startsWith('https://api.github.com/repos/taalcut/hub/'))).toBe(true);
    expect(seen.find((call) => call.url.endsWith('/labels'))?.body).toEqual({
      labels: ['submission', 'via-app'],
    });
  });

  it('reuses a branch an earlier attempt made and replaces a file already there', async () => {
    const { github, seen } = recorded((method, url) => {
      if (url.includes('/git/ref/heads/')) return ref('c'.repeat(40));
      if (url.endsWith('/git/refs')) return json('{"message":"Reference already exists"}', 422);
      if (url.includes('/contents/') && method === 'GET')
        return json(JSON.stringify({ sha: 'e'.repeat(40) }));
      if (url.includes('/contents/') && method === 'PUT') {
        const puts = seen.filter((call) => call.method === 'PUT').length;
        return puts === 1 ? json('{"message":"sha wasn\'t supplied"}', 422) : json('{"content":{}}');
      }
      return undefined;
    });
    expect((await github.createBranch(BRANCH, 'main')).ok).toBe(true);
    expect((await github.putFile('templates/01/x.json', '{}\n', BRANCH, 'Add')).ok).toBe(true);
    expect(seen.filter((call) => call.method === 'PUT').at(-1)?.body).toMatchObject({ sha: 'e'.repeat(40) });
  });

  it('reads a pull request merged from the recorded fixture', async () => {
    const { github } = recorded((_method, url) => (url.endsWith('/pulls/17') ? json(MERGED) : undefined));
    expect(await github.pullRequestState(17)).toEqual({ ok: true, value: 'merged' });
  });

  it('reads a raw file, and a missing one as null', async () => {
    const { github, seen } = recorded((_method, url) => {
      if (url.includes('/contents/moderation/hidden.json?ref=main')) return new Response('[]\n');
      if (url.includes('/contents/moderation/missing.json')) return json('{"message":"Not Found"}', 404);
      return undefined;
    });
    expect(await github.readFile('moderation/hidden.json', 'main')).toEqual({ ok: true, value: '[]\n' });
    expect(seen[0]?.accept).toBe('application/vnd.github.raw+json');
    expect(await github.readFile('moderation/missing.json', 'main')).toEqual({ ok: true, value: null });
  });

  it('answers a status, a missing network and a wrong shape as values', async () => {
    const down = recorded(() => json('{}', 502));
    expect(await down.github.openIssue({ title: 't', body: 'b', labels: [] })).toEqual({
      ok: false,
      failure: { kind: 'status', status: 502 },
    });
    const offline = createRestGitHub({
      repo: 'taalcut/hub',
      token: async () => ({ ok: true, value: 'ghs_test_not_a_real_token' }),
      fetch: async () => Promise.reject(new TypeError('fetch failed')),
    });
    expect(await offline.commentIssue(1, 'x')).toEqual({ ok: false, failure: { kind: 'network' } });
    const odd = recorded(() => json('{"id":3}', 201));
    expect(await odd.github.openIssue({ title: 't', body: 'b', labels: [] })).toEqual({
      ok: false,
      failure: { kind: 'shape', what: 'POST /issues' },
    });
    const noToken = createRestGitHub({
      repo: 'taalcut/hub',
      token: async () => ({ ok: false, failure: { kind: 'status', status: 401 } }),
      fetch: async () => Promise.reject(new Error('must not be called')),
    });
    expect(await noToken.pullRequestState(1)).toEqual({
      ok: false,
      failure: { kind: 'status', status: 401 },
    });
  });
});
