// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Round P3-3, platform requests: a job that runs inside its parent's slot, the render process's runner, web
 * pages a window may open, the request log's filters, a subscription's
 * usage page, the build's own update channel and onboarding's restore. Everything stored before still parses.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  accountsStateSchema,
  connectRpc,
  createDirectJobRunner,
  defineJobKind,
  EXTERNAL_LINK_HOSTS,
  externalLinkSchema,
  filesContract,
  isExternalLink,
  jobRunnerContract,
  jobRunnerOverRpc,
  jobRunnerRouter,
  MAIN_SERVICE_CONTRACTS,
  newId,
  ok,
  ONBOARDING_COMMANDS,
  ONBOARDING_SETTING,
  onboardingCommandPayloads,
  registerJob,
  serveRpc,
  UPDATE_COMMANDS,
  updateCommandPayloads,
  usageContract,
  usageListInputSchema,
  usageRouter,
  type JobRunOptions,
  type JobRunner,
  type UsageStore,
} from '@taalcut/core';
import { inputOf, serve } from './helpers/phase3';
import { channel } from './helpers/ports';

const bakeKind = defineJobKind({
  kind: 'vision.bakeGrade',
  input: z.object({ clip: z.string() }),
  output: z.object({ lut: z.string() }),
  resource: 'gpu',
});

describe('a job inside a running job', () => {
  it("names its parent through the runner over IPC, so the queue can run it in the parent's slot", async () => {
    const seen: JobRunOptions[] = [];
    const registered = [registerJob(bakeKind, async ({ clip }) => ok({ lut: `${clip}.cube` }))];
    const direct = createDirectJobRunner(registered);
    const recording: JobRunner = {
      run: (kind, input, options = {}) => {
        seen.push(options);
        return direct.run(kind, input, options);
      },
    };
    const { port1, port2 } = channel();
    serveRpc(jobRunnerRouter(recording, registered), port1, { context: {} });
    const client = connectRpc(jobRunnerContract, port2, { peer: 'jobs' }).client;
    const runner = jobRunnerOverRpc(() => client);
    const parentJobId = newId<'Job'>();
    expect(await runner.run(bakeKind, { clip: 'a' }, { parentJobId })).toEqual({
      ok: true,
      value: { lut: 'a.cube' },
    });
    expect(await runner.run(bakeKind, { clip: 'b' })).toEqual({ ok: true, value: { lut: 'b.cube' } });
    expect(seen.map((options) => options.parentJobId)).toEqual([parentJobId, undefined]);
    expect(
      inputOf(jobRunnerContract.run, { kind: 'vision.bakeGrade', input: {}, parentJobId: 'job' }).success,
    ).toBe(false);
  });

  it("is what the render process's main services offer, beside telemetry", () => {
    expect(Object.keys(MAIN_SERVICE_CONTRACTS.render).sort()).toEqual(['embeddings', 'runner', 'telemetry']);
    expect(MAIN_SERVICE_CONTRACTS.render.runner).toBe(jobRunnerContract);
  });
});

describe('web pages a window may open', () => {
  it('are https pages on the listed hosts, with nothing in front of the host', () => {
    for (const url of [
      'https://platform.openai.com/settings/organization/billing',
      'https://chatgpt.com/settings/usage',
      'https://GitHub.com/taalcut/taalcut',
      'https://taalcut.app/beta-terms/',
      'https://elevenlabs.io/app/subscription#credits',
    ])
      expect(isExternalLink(url), url).toBe(true);
    for (const url of [
      'http://platform.openai.com/',
      'https://example.com/',
      'https://openai.com/',
      'https://platform.openai.com.evil.example/',
      'https://github.com./',
      'https://me:secret@github.com/',
      'https://github.com:444/',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'not a url',
      '',
    ])
      expect(isExternalLink(url), url).toBe(false);
    expect(new Set(EXTERNAL_LINK_HOSTS).size).toBe(EXTERNAL_LINK_HOSTS.length);
    expect(externalLinkSchema.safeParse(`https://github.com/${'a'.repeat(2048)}`).success).toBe(false);
  });

  it('go through files.openExternal, which checks the page before main sees it', () => {
    expect(
      inputOf(filesContract.openExternal, { url: 'https://openrouter.ai/settings/credits' }).success,
    ).toBe(true);
    const refused = inputOf(filesContract.openExternal, { url: 'https://example.com/' });
    expect(!refused.success && refused.error.issues[0]?.path).toEqual(['url']);
  });

  it("include a warned subscription's usage page, absent in what main sent before", () => {
    const warning = {
      feature: 'login.anthropic',
      termsVersion: '1',
      titleKey: 't',
      bodyKey: 'b',
      riskKey: 'r',
    };
    const state = {
      chatgpt: { signedIn: false, manageUsageUrl: 'https://chatgpt.com/settings' },
      subscriptions: [{ provider: 'anthropic', signedIn: true, warning }],
      apiKeys: [],
      localServers: [],
    };
    expect(accountsStateSchema.parse(state).subscriptions[0]?.usageUrl).toBeUndefined();
    const withPage = {
      ...state,
      subscriptions: [{ ...state.subscriptions[0], usageUrl: 'https://claude.ai/settings/usage' }],
    };
    expect(accountsStateSchema.parse(withPage).subscriptions[0]?.usageUrl).toBe(
      'https://claude.ai/settings/usage',
    );
    const offList = {
      ...state,
      subscriptions: [{ ...state.subscriptions[0], usageUrl: 'https://example.com/' }],
    };
    expect(accountsStateSchema.safeParse(offList).success).toBe(false);
  });
});

describe("the request log's filters", () => {
  it("are the dashboard's, and reach the store as given", async () => {
    const asked: unknown[] = [];
    const totals = {
      calls: 0,
      localCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      costUsd: 0,
    };
    const store: UsageStore = {
      list: async (input) => {
        asked.push(input);
        return ok({ records: [], totals });
      },
    };
    const client = serve(usageContract, usageRouter(store));
    const projectId = newId<'Project'>();
    await client.list({ from: 1_000, before: 9_000, module: 'vision', provider: 'openai', projectId });
    await client.list({});
    expect(asked).toEqual([
      { limit: 100, from: 1_000, before: 9_000, module: 'vision', provider: 'openai', projectId },
      { limit: 100 },
    ]);
    expect(usageListInputSchema.safeParse({ from: 9_000, before: 1_000 }).success).toBe(false);
    expect(usageListInputSchema.safeParse({ provider: '' }).success).toBe(false);
  });
});

describe('settings commands', () => {
  it("can put the update channel back to the build's own", () => {
    const set = updateCommandPayloads[UPDATE_COMMANDS.setChannel];
    expect(set.parse({ channel: null })).toEqual({ projectId: null, channel: null });
    expect(set.parse({ channel: 'stable' })).toEqual({ projectId: null, channel: 'stable' });
    expect(set.safeParse({}).success).toBe(false);
  });

  it("name onboarding's restore, whose payload is the progress as stored", () => {
    expect(ONBOARDING_COMMANDS.restore).toBe('onboarding.restore');
    const restore = onboardingCommandPayloads[ONBOARDING_COMMANDS.restore];
    expect(restore.parse(ONBOARDING_SETTING.defaultValue)).toEqual(ONBOARDING_SETTING.defaultValue);
    expect(restore.safeParse({ step: 'nowhere' }).success).toBe(false);
  });
});
