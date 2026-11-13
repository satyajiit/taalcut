// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 dsn: the evals' own ChatGPT sign-in and eval:design on the plan, against a mock OAuth server and a mock
 * OpenAI (models' test-support), in a temporary HOME. The sign-in lands in ~/.taalcut-eval/credentials.json (0600,
 * in a 0700 folder that holds nothing else) and prints its address but no token; signing out deletes the file; a
 * call through the plan's client goes out as the app's does (store false, streamed, the plan's model, the rejected
 * fields gone, the sign-in's access token); and a design run on the plan keeps every token out of its lines,
 * design.json and design.md, even when the model says one back.
 */
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeBrowser,
  startMockOAuthServer,
  startMockProviderServer,
  type MockOAuthServer,
  type MockProviderServer,
} from '@taalcut/models/test-support';
import { designMode } from '../../src/design/design-mode';
import { designModels } from '../../src/design/models';
import { evalCredentialsPath } from '../../src/plan/credentials-file';
import { signedInPlan, type PlanOptions } from '../../src/plan/chatgpt';
import { signIn, signOut } from '../../src/plan/signin';

const MODEL = 'gpt-6-astra';

let home = '';
let oauth: MockOAuthServer;
let provider: MockProviderServer;
let options: PlanOptions;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'taalcut-eval-home-'));
  vi.stubEnv('HOME', home);
  oauth = await startMockOAuthServer();
  provider = await startMockProviderServer();
  options = {
    runtime: {
      baseUrlOverrides: { openai: provider.openaiBaseUrl },
      signIn: { chatgpt: { authorizeUrl: oauth.authorizeUrl, tokenUrl: oauth.tokenUrl, callbackPort: 0 } },
    },
  };
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all([oauth.close(), provider.close()]);
  await rm(home, { recursive: true, force: true });
});

/** Signs in through the fake browser; the lines it printed. */
async function signedIn(): Promise<string[]> {
  const lines: string[] = [];
  await signIn('chatgpt', { say: (line) => lines.push(line), openBrowser: createFakeBrowser().open }, options);
  return lines;
}

const leaks = (text: string) => oauth.secrets().filter((secret) => text.includes(secret));

describe('the evals’ ChatGPT sign-in', () => {
  it('keeps it in ~/.taalcut-eval/credentials.json, 0600 in a 0700 folder of its own, and prints no token', async () => {
    const lines = await signedIn();
    const { folder, file } = evalCredentialsPath();
    expect(folder).toBe(join(home, '.taalcut-eval'));
    expect((await stat(folder)).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readdir(folder)).toEqual(['credentials.json']);
    // The sign-in is in the file, refresh token and all; none of it on the lines.
    expect(await readFile(file, 'utf8')).toContain(oauth.issued[0]!.refresh);
    expect(lines.some((line) => line.includes(oauth.authorizeUrl))).toBe(true);
    expect(lines.at(-1)).toMatch(/^Signed in as ada@example\.com\./);
    expect(leaks(lines.join('\n'))).toEqual([]);
  });

  it('signs out by deleting the file', async () => {
    await signedIn();
    const said: string[] = [];
    expect(await signOut({ say: (line) => said.push(line) })).toBe(true);
    await expect(stat(evalCredentialsPath().file)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(signedInPlan('chatgpt', options)).rejects.toThrow(/eval:signin chatgpt/);
    expect(await signOut({ say: (line) => said.push(line) })).toBe(false);
  });
});

describe('eval:design on the ChatGPT plan', () => {
  it('sends a call as the app does: store false, streamed, the plan’s model, the sign-in’s token', async () => {
    await signedIn();
    const plan = await signedInPlan('chatgpt', options);
    const answer = await plan
      .client(MODEL)
      .complete({ module: 'agent', messages: [{ role: 'user', content: 'Say hello.' }], maxTokens: 100, temperature: 0 });
    expect(answer.ok).toBe(true);
    const [sent] = provider.requests;
    expect(sent).toMatchObject({ route: 'openai', body: { model: MODEL, store: false, stream: true } });
    expect(sent!.body).not.toHaveProperty('temperature');
    expect(sent!.body).not.toHaveProperty('max_output_tokens');
    expect(sent!.headers.authorization).toBe(`Bearer ${oauth.issued.at(-1)!.access}`);
    expect(plan.seesImages(MODEL)).toBe(true);
  });

  it('keeps every token out of its lines, design.json and design.md, even one the model says back', async () => {
    await signedIn();
    const token = oauth.issued.at(-1)!.access;
    for (let reply = 0; reply < 6; reply++) provider.script('openai', { kind: 'reply', text: `All set: ${token}` });
    const models = await designModels({ standIn: false, plan: 'chatgpt', model: MODEL, vision: false, planOptions: options }, null);
    const out = await mkdtemp(join(home, 'out-'));
    const lines: string[] = [];
    const report = await designMode({
      root: await mkdtemp(join(home, 'root-')),
      out,
      cases: ['countdown'],
      frames: 'stand-in',
      live: models.live,
      judge: models.judge,
      label: models.label,
      scrub: models.scrub,
      log: (line) => lines.push(line),
    });
    expect(report.model).toBe(`${MODEL} (ChatGPT plan)`);
    expect(provider.requests.length).toBeGreaterThan(0);
    for (const request of provider.requests) expect(request.body).toMatchObject({ model: MODEL, store: false, stream: true });
    const json = await readFile(join(out, 'design.json'), 'utf8');
    const markdown = await readFile(join(out, 'design.md'), 'utf8');
    // The model's words reached the report, its token scrubbed out.
    expect(json).toContain('All set: [REDACTED]');
    expect(leaks(lines.join('\n'))).toEqual([]);
    expect(leaks(json)).toEqual([]);
    expect(leaks(markdown)).toEqual([]);
  });
});
