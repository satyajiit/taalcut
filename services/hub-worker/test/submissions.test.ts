// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { hubSubmissionResponseSchema } from '@taalcut/core/hub';
import { describe, expect, it } from 'vitest';

import { installHash } from '../src/identity/install-hash';
import { SUBMIT_GLOBAL_PER_DAY, SUBMIT_PER_DAY, utcDay } from '../src/limits/rate-limits';
import { takeDailyUnit } from '../src/store/d1-days';
import { createTestHub, expectNoCors, TEST_SALT, type TestHub } from './harness';
import { DIGIT_HUB_ID, HUB_ID, INSTALL_A, INSTALL_B, makeTemplate, OTHER_HUB_ID } from './template';

function post(hub: TestHub, template: unknown, installKey = INSTALL_A): Promise<Response> {
  return hub.request('https://hub.example/v0/submissions', {
    method: 'POST',
    body: JSON.stringify({ installKey, template }),
  });
}

async function problemsOf(response: Response): Promise<{ path: string; rule: string }[]> {
  expect(response.status).toBe(400);
  const body = (await response.json()) as { code: string; problems: { path: string; rule: string }[] };
  expect(body.code).toBe('hub.invalid');
  return body.problems;
}

describe('submissions', () => {
  it('opens a pull request for a valid template', async () => {
    const hub = createTestHub();
    const response = await post(hub, makeTemplate());
    expect(response.status).toBe(202);
    expectNoCors(response);
    const body = hubSubmissionResponseSchema.parse(await response.json());
    expect(body).toMatchObject({ hubId: HUB_ID, version: 1, state: 'open', pullRequest: 1 });
    const pull = hub.github.pulls[0];
    expect(pull?.title).toBe('Template: Weekend trip by ada');
    expect(pull?.labels).toEqual(['submission', 'via-app']);
    expect(pull?.head).toBe(`submit/${HUB_ID}-v1`);
    expect(pull?.base).toBe('main');
    expect(pull?.body).toContain('CC0-1.0');
    expect(pull?.body).toContain('Handle: ada');
    expect(pull?.body).toContain('validated');
    expect(pull?.body).not.toContain(INSTALL_A);
    const file = hub.github.file(`submit/${HUB_ID}-v1`, `templates/01/${HUB_ID}.json`);
    expect(file?.startsWith('{\n  "description"')).toBe(true);
    expect(JSON.stringify(hub.db.snapshot())).not.toContain(INSTALL_A);
  });

  it('returns the existing submission for the same document', async () => {
    const hub = createTestHub();
    const first = hubSubmissionResponseSchema.parse(await (await post(hub, makeTemplate())).json());
    const second = await post(hub, makeTemplate());
    expect(second.status).toBe(202);
    expect(await second.json()).toMatchObject({
      submissionId: first.submissionId,
      pullRequest: first.pullRequest,
    });
    expect(hub.github.pulls).toHaveLength(1);
  });

  it('refuses a hub id owned by another install', async () => {
    const hub = createTestHub();
    expect((await post(hub, makeTemplate())).status).toBe(202);
    const other = makeTemplate();
    other.name = 'Another cut';
    const response = await post(hub, other, INSTALL_B);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'hub.not_owner' });
    expect(hub.github.pulls).toHaveLength(1);
  });

  it('refuses an update that skips a version', async () => {
    const hub = createTestHub();
    expect((await post(hub, makeTemplate())).status).toBe(202);
    const skipped = makeTemplate();
    skipped.version = 3;
    expect(await problemsOf(await post(hub, skipped))).toEqual([{ path: 'version', rule: 'schema' }]);
  });

  it('rejects a URL and a data URI', async () => {
    const hub = createTestHub();
    const linked = makeTemplate();
    linked.description = 'see https://evil.example/x';
    expect(await problemsOf(await post(hub, linked))).toContainEqual({ path: 'description', rule: 'url' });

    const data = makeTemplate();
    const hook = data.structure.slots[0];
    if (hook) hook.intent.text = 'data:text/plain,hello';
    expect(await problemsOf(await post(hub, data))).toContainEqual({
      path: 'structure.slots.0.intent.text',
      rule: 'dataUri',
    });
    expect(hub.github.pulls).toHaveLength(0);
  });

  it('checks every key and string at every depth (contract round P3-2)', async () => {
    const hub = createTestHub();
    const template = makeTemplate();
    const nested = {
      ...template,
      structure: { ...template.structure, canvas: { ...template.structure.canvas, frames: [] } },
    };
    expect(await problemsOf(await post(hub, nested))).toContainEqual({
      path: 'structure.canvas',
      rule: 'schema',
    });

    const keyed = { ...template, style: { 'https://evil.example': 1 } };
    const problems = await problemsOf(await post(hub, keyed));
    expect(problems).toContainEqual({ path: 'style.https://evil.example', rule: 'url' });

    const pathed = makeTemplate();
    const walk = pathed.structure.slots[1];
    if (walk) walk.intent.text = 'from /Users/ada/clips/walk.mov';
    expect(await problemsOf(await post(hub, pathed))).toContainEqual({
      path: 'structure.slots.1.intent.text',
      rule: 'path',
    });

    const unreduced = makeTemplate();
    unreduced.structure.canvas.rate = { num: 60, den: 2 };
    expect(await problemsOf(await post(hub, unreduced))).toContainEqual({
      path: 'structure.canvas.rate',
      rule: 'schema',
    });
    expect(hub.github.pulls).toHaveLength(0);
  });

  it('accepts an id with nine digits in a row when the prose is clean', async () => {
    const hub = createTestHub();
    const response = await post(hub, makeTemplate(DIGIT_HUB_ID));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ hubId: DIGIT_HUB_ID });
  });

  it('rate limits a burst, a daily cap and the global cap', async () => {
    const burst = createTestHub({ submitLimit: 1 });
    expect((await post(burst, makeTemplate())).status).toBe(202);
    const limited = await post(burst, makeTemplate(OTHER_HUB_ID));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: 'hub.rate_limited', retryAfterSeconds: 10 });

    const day = utcDay(Date.now());
    const daily = createTestHub();
    const hmac = await installHash(TEST_SALT, INSTALL_A);
    for (let index = 0; index < SUBMIT_PER_DAY; index += 1) {
      expect(await takeDailyUnit(daily.db, `submit:${hmac}`, day, SUBMIT_PER_DAY)).toBe(true);
    }
    const overDay = await post(daily, makeTemplate());
    expect(overDay.status).toBe(429);
    expect(await overDay.json()).toMatchObject({ code: 'hub.rate_limited' });

    const busy = createTestHub();
    for (let index = 0; index < SUBMIT_GLOBAL_PER_DAY; index += 1) {
      await takeDailyUnit(busy.db, 'submit:*', day, SUBMIT_GLOBAL_PER_DAY);
    }
    const overGlobal = await post(busy, makeTemplate());
    expect(overGlobal.status).toBe(429);
    expect(await overGlobal.json()).toMatchObject({ code: 'hub.busy' });
  });

  it('lets exactly the cap through when the requests arrive together', async () => {
    const hub = createTestHub();
    const day = utcDay(Date.now());
    const taken = await Promise.all(
      Array.from({ length: 12 }, () => takeDailyUnit(hub.db, 'submit:race', day, SUBMIT_PER_DAY)),
    );
    expect(taken.filter(Boolean)).toHaveLength(SUBMIT_PER_DAY);
  });

  it('refuses a body over 256 KiB before parsing', async () => {
    const hub = createTestHub();
    const response = await hub.request('https://hub.example/v0/submissions', {
      method: 'POST',
      body: new Uint8Array(256 * 1024 + 1),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      code: 'hub.invalid',
      problems: [{ path: '', rule: 'tooLarge' }],
    });
    expect(hub.github.pulls).toHaveLength(0);
  });

  it('returns 503 when GitHub fails and reuses the branch on the retry', async () => {
    const hub = createTestHub();
    hub.github.failing.add('pull');
    const down = await post(hub, makeTemplate());
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ code: 'hub.github_unavailable' });
    expect(hub.github.branches.has(`submit/${HUB_ID}-v1`)).toBe(true);
    hub.github.failing.clear();
    expect((await post(hub, makeTemplate())).status).toBe(202);
    expect(hub.github.pulls).toHaveLength(1);
  });

  it('closes a superseded pull request, and retries one that would not close', async () => {
    const hub = createTestHub();
    expect((await post(hub, makeTemplate())).status).toBe(202);
    hub.github.failing.add('close');
    const second = makeTemplate();
    second.version = 2;
    second.name = 'Weekend trip two';
    expect((await post(hub, second)).status).toBe(202);
    expect(hub.github.pulls[0]?.state).toBe('open');
    hub.github.failing.clear();
    const third = makeTemplate();
    third.version = 3;
    third.name = 'Weekend trip three';
    expect((await post(hub, third)).status).toBe(202);
    expect(hub.github.pulls.map((pull) => pull.state)).toEqual(['closed', 'closed', 'open']);
    expect(hub.github.closedComments[0]?.comment).toContain('Superseded');
  });
});
