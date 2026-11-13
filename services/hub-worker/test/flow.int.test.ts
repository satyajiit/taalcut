// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hubIndexSchema, hubTemplateV0Schema } from '@taalcut/core/hub';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestHub, expectNoCors } from './harness';
import { HUB_ID, INSTALL_A, makeTemplate } from './template';

const scripts = join(import.meta.dirname, '..', '..', '..', 'hub', 'scripts');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('publish flow', () => {
  it('submits, validates, merges and publishes an index a second client can read', async () => {
    const hub = createTestHub();
    const health = await hub.request('https://hub.example/v0/health');
    expect(health.status).toBe(200);
    expectNoCors(health);
    expect(await health.json()).toEqual({ ok: true, formatVersion: 0 });

    const posted = await hub.request('https://hub.example/v0/submissions', {
      method: 'POST',
      body: JSON.stringify({ installKey: INSTALL_A, template: makeTemplate() }),
    });
    expect(posted.status).toBe(202);
    const submission = (await posted.json()) as { submissionId: string; pullRequest: number; hubId: string };
    expect(submission.hubId).toBe(HUB_ID);
    const file = hub.github.file(`submit/${HUB_ID}-v1`, `templates/01/${HUB_ID}.json`);
    expect(file).toBeTruthy();
    if (!file) return;

    const root = mkdtempSync(join(tmpdir(), 'taalcut-flow-'));
    roots.push(root);
    mkdirSync(join(root, 'templates', '01'), { recursive: true });
    mkdirSync(join(root, 'moderation'), { recursive: true });
    writeFileSync(join(root, 'templates', '01', `${HUB_ID}.json`), file);
    writeFileSync(join(root, 'moderation', 'hidden.json'), '[]\n');

    const validated = spawnSync(
      process.execPath,
      [join(scripts, 'validate.mjs'), '--root', root, '--files', `templates/01/${HUB_ID}.json`],
      { encoding: 'utf8' },
    );
    expect(validated.status, validated.stderr ?? '').toBe(0);

    hub.github.markMerged(submission.pullRequest);
    const state = await hub.request(`https://hub.example/v0/submissions/${submission.submissionId}`);
    expect(state.status).toBe(200);
    expect(await state.json()).toEqual({ state: 'merged' });

    const now = '1700000000000';
    const built = spawnSync(
      process.execPath,
      [join(scripts, 'build-index.mjs'), '--root', root, '--now', now],
      {
        encoding: 'utf8',
      },
    );
    expect(built.status, built.stderr ?? '').toBe(0);

    const indexText = readFileSync(join(root, 'site', 'v0', 'index.json'), 'utf8');
    const index = hubIndexSchema.parse(JSON.parse(indexText));
    const entry = index.templates.find((item) => item.id === HUB_ID);
    expect(entry).toBeTruthy();
    const published = readFileSync(join(root, 'site', 'v0', 'templates', `${HUB_ID}.json`));
    expect(entry?.sha256).toBe(createHash('sha256').update(published).digest('hex'));
    hubTemplateV0Schema.parse(JSON.parse(published.toString('utf8')));
    expect(index.generatedAt).toBe(Number(now));
  });
});
