// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The breakdown tools: metadata by placement, JSON Schema, cost estimate, and
 * runs against a job runner double (the jobs themselves are tested on real
 * reels in test/integration/breakdown-*.test.ts).
 */
import {
  defineToolModule,
  err,
  NO_TOOL_RETRY,
  NotFoundError,
  ok,
  toolModuleProblems,
  toolNeedsApproval,
  type Result,
} from '@taalcut/core';
import { fileFingerprint, type JobRunner } from '@taalcut/media';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CutList } from '../src/breakdown/types';
import { estimateImageTokens } from '../src/describe/image-tokens';
import type { VisionDeps } from '../src/describe/describe-frame';
import type { VisionPlacement } from '../src/describe/placement';
import { BREAKDOWN_JOB_STAGES, type ContactSheetJobOutput } from '../src/jobs/breakdown-kinds';
import { breakdownTools, summarizeCuts } from '../src/tools/breakdown-tools';
import { visionToolModule } from '../src/tools/describe-frame-tool';
import {
  FAKE_JPEG,
  GEMINI,
  mutableSelector,
  OLLAMA_VL,
  OLLAMA_VL_SMALL,
  scriptedClient,
  testRuntime,
  testToolContext,
  type ScriptedAttempt,
} from './helpers/fakes';

const runtime = testRuntime();
const PATH = '/Volumes/Refs/reel.mp4';
const RATE = { num: 30, den: 1 };
const at = (value: number) => ({ value, rate: RATE });

const CUT_LIST: CutList = {
  frameRate: RATE,
  frameCount: 300,
  cuts: [
    { frame: 24, at: at(24), kind: 'hard', confidence: 0.9, method: 'scdet', status: 'confirmed', score: 60 },
    { frame: 80, at: at(80), kind: 'hard', confidence: 0.4, method: 'both', status: 'disputed', score: 9 },
    {
      frame: 144,
      at: at(144),
      kind: 'soft',
      transition: 'dissolve',
      confidence: 0.6,
      method: 'embedding',
      status: 'disputed',
      distance: 0.27,
    },
  ],
  softScanFps: 2,
  notes: [],
};

function sheet(rows: number): ContactSheetJobOutput {
  return {
    jpegBase64: FAKE_JPEG.toString('base64'),
    width: 1280,
    height: rows * 144,
    columns: 5,
    tileWidth: 256,
    tileHeight: 144,
    frameRate: RATE,
    layout: Array.from({ length: rows }, (_, row) => ({ tile: row * 5, frame: row, at: at(row), row })),
  };
}

/** A JobRunner that answers the breakdown's kinds, validating outputs like the real one. */
function breakdownJobs() {
  const calls: { kind: string; input: Record<string, unknown> }[] = [];
  const runner: JobRunner = {
    async run(kind, input, options = {}) {
      const job = input as Record<string, unknown>;
      calls.push({ kind: kind.kind, input: job });
      options.onProgress?.({ fraction: 0.5, stageKey: BREAKDOWN_JOB_STAGES.makingContactSheet });
      let output: Result<unknown>;
      if (kind.kind === 'vision.detectCuts') output = ok(CUT_LIST);
      else if (kind.kind === 'vision.contactSheet') {
        const layout = job.layout as {
          kind: string;
          candidates?: unknown[];
          cuts?: number[];
          at?: unknown[];
        };
        const tiles =
          layout.candidates?.length ?? (layout.cuts ? layout.cuts.length + 1 : (layout.at?.length ?? 1));
        output = ok(sheet(tiles));
      } else if (kind.kind === 'vision.readOverlays')
        output = ok({ frameRate: RATE, overlays: [], truncated: false });
      else output = err(NotFoundError({ entity: 'job kind', id: kind.kind }));
      if (!output.ok) return output as Result<never>;
      return ok(kind.output.parse(output.value)) as Result<never>;
    },
  };
  return { runner, calls };
}

function setup(
  chain = [OLLAMA_VL, GEMINI],
  placement: VisionPlacement = 'cloud',
  attempts?: (request: number) => ScriptedAttempt[],
) {
  const jobs = breakdownJobs();
  let count = 0;
  const models = scriptedClient(
    () =>
      attempts?.(count++) ?? [
        { choice: GEMINI, local: false, outcome: { text: '[{"row":0,"cut":true,"transition":null}]' } },
      ],
  );
  const deps: VisionDeps = { jobs: jobs.runner, models, selector: mutableSelector(chain), runtime };
  const tools = breakdownTools(deps, placement);
  const [detect, confirm, read, sheet] = tools;
  const byName = (name: string) => tools.find((t) => t.name === name)!;
  return { tools, byName, detect, confirm, read, sheet, jobs, models };
}

describe('metadata', () => {
  it.each(['cloud', 'local'] as const)('registers cleanly with %s placement', (placement) => {
    const { tools } = setup(undefined, placement);
    expect(tools.map((t) => t.name)).toEqual([
      'vision.detectCuts',
      'vision.confirmCuts',
      'vision.readText',
      'vision.contactSheet',
    ]);
    expect(toolModuleProblems(defineToolModule({ id: 'vision', tools: [...tools] }))).toEqual([]);
  });

  it('joins visionToolModule only when asked (the gate demo replays the tools it was recorded with)', () => {
    const { models } = setup();
    const deps: VisionDeps = {
      jobs: breakdownJobs().runner,
      models,
      selector: mutableSelector([GEMINI]),
      runtime,
    };
    expect(visionToolModule(deps).tools.map((t) => t.name)).toEqual(['vision.describeFrame']);
    const all = visionToolModule(deps, { breakdown: true });
    expect(all.tools).toHaveLength(5);
    expect(toolModuleProblems(all)).toEqual([]);
  });

  it('the breakdown tools never leave the device and cache for an hour', () => {
    const { byName } = setup();
    for (const name of ['vision.detectCuts', 'vision.readText', 'vision.contactSheet']) {
      const tool = byName(name);
      expect(tool).toMatchObject({
        version: '1.0.0',
        costClass: 'local',
        sideEffect: 'read',
        permission: { network: 'none', filesystem: { read: ['library', 'user-selected', 'scratch'] } },
        retry: { maxAttempts: 2 },
        cache: { ttlMs: 3_600_000 },
      });
      expect(toolNeedsApproval(tool)).toBe(false);
    }
    expect(byName('vision.detectCuts').timeoutMs).toBe(600_000);
    expect(byName('vision.contactSheet').timeoutMs).toBe(120_000);
  });

  it('confirmCuts is an upload with a cloud model, a local read without', () => {
    const cloud = setup().confirm;
    expect(cloud).toMatchObject({
      costClass: 'cloud',
      sideEffect: 'external',
      retry: NO_TOOL_RETRY,
      timeoutMs: 180_000,
      permission: { network: 'internet', cloudModules: ['vision'], uploads: { what: 'user-media' } },
    });
    expect(cloud.cache).toBeUndefined();
    expect(toolNeedsApproval(cloud)).toBe(true);
    const local = setup([OLLAMA_VL], 'local').confirm;
    expect(local).toMatchObject({ costClass: 'local', sideEffect: 'read', permission: { network: 'lan' } });
    expect(local.permission?.uploads).toBeUndefined();
    expect(local.description).toMatch(/nothing leaves the device/);
  });

  it('converts every schema to JSON Schema and marks model and on-screen text untrusted', () => {
    const { tools, byName } = setup();
    for (const tool of tools) {
      expect(() => z.toJSONSchema(tool.input, { unrepresentable: 'throw', io: 'input' })).not.toThrow();
      expect(() => z.toJSONSchema(tool.output, { unrepresentable: 'throw' })).not.toThrow();
    }
    const json = (name: string) => JSON.stringify(z.toJSONSchema(byName(name).output));
    expect(json('vision.readText')).toContain('"untrusted":"on-screen-text"');
    expect(json('vision.confirmCuts')).toContain('"untrusted":"vision"');
    expect(byName('vision.readText').summarize).toBeUndefined();
    expect(byName('vision.confirmCuts').summarize).toBeUndefined();
  });

  it('keys repeats on the file and the options', () => {
    const { detect, confirm } = setup();
    expect(detect.idempotencyKey?.(detect.input.parse({ path: PATH }))).toBe(
      `${fileFingerprint(PATH)}:normal:all`,
    );
    expect(confirm.idempotencyKey?.({ path: PATH, candidates: [at(80), at(144)] })).toBe(
      `${fileFingerprint(PATH)}:80@30/1,144@30/1`,
    );
  });
});

describe('vision.confirmCuts cost estimate', () => {
  it('prices one strip per 6 candidates on the dearest cloud model, zero on device', () => {
    const tool = setup().confirm;
    const one = tool.estimateCost?.({ path: PATH, candidates: [at(80)] });
    const seven = tool.estimateCost?.({
      path: PATH,
      candidates: Array.from({ length: 7 }, (_, i) => at(i * 10 + 5)),
    });
    const info = runtime.findModel(GEMINI.provider, GEMINI.model, 'chat')!;
    const input = estimateImageTokens(GEMINI.provider, GEMINI.model, 1280, 256) + 300;
    expect(one?.usd).toBeCloseTo((input * info.price.input + 100 * info.price.output) / 1e6, 9);
    expect(one?.basis).toMatch(/1 strip\(s\) of 1280 px wide/);
    expect(seven?.basis).toMatch(/2 strip\(s\)/);
    expect(seven!.usd).toBeGreaterThan(one!.usd);
    expect(
      setup([OLLAMA_VL], 'local').confirm.estimateCost?.({ path: PATH, candidates: [at(1)] }),
    ).toMatchObject({ usd: 0 });
  });
});

describe('vision.confirmCuts run', () => {
  it('sends one strip per 6 candidates and maps the rows back to the times', async () => {
    const answer = (rows: number) =>
      JSON.stringify(
        Array.from({ length: rows }, (_, row) => ({ row, cut: row % 2 === 0, transition: 'fade' })),
      );
    const { confirm, jobs, models } = setup(undefined, 'cloud', (n) => [
      { choice: GEMINI, local: false, outcome: { text: answer(n === 0 ? 6 : 1), costUsd: 0.001 } },
    ]);
    const candidates = Array.from({ length: 7 }, (_, i) => at(i * 40 + 20));
    const ctx = testToolContext();
    const result = await confirm.run({ path: PATH, candidates }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decisions.map((d) => [d.at.value, d.cut, d.transition])).toEqual([
      [20, true, 'fade'],
      [60, false, undefined],
      [100, true, 'fade'],
      [140, false, undefined],
      [180, true, 'fade'],
      [220, false, undefined],
      [260, true, 'fade'],
    ]);
    expect(result.value).toMatchObject({
      model: { provider: 'google', local: false },
      uploadedTo: ['google'],
    });
    expect(
      jobs.calls.map((c) => [c.kind, (c.input.layout as { candidates: unknown[] }).candidates.length]),
    ).toEqual([
      ['vision.contactSheet', 6],
      ['vision.contactSheet', 1],
    ]);
    const request = models.requests[0]!;
    expect(request).toMatchObject({
      module: 'vision',
      temperature: 0,
      reasoning: 'off',
      maxTokens: 60 + 40 * 6,
    });
    expect(request.messages[0]).toMatchObject({
      content: [
        { type: 'text' },
        { type: 'image', data: FAKE_JPEG.toString('base64'), mimeType: 'image/jpeg' },
      ],
    });
    expect(ctx.usage).toHaveLength(2);
    expect(ctx.progress.at(-1)).toEqual({ fraction: 1 });
  });

  it('asks once more when the answer is not the JSON asked for, then gives up', async () => {
    const retried = setup(undefined, 'cloud', (n) => [
      {
        choice: GEMINI,
        local: false,
        outcome: { text: n === 0 ? 'Row 0 is a cut.' : '[{"row":0,"cut":false}]' },
      },
    ]);
    const ok1 = await retried.confirm.run({ path: PATH, candidates: [at(80)] }, testToolContext());
    expect(ok1.ok && ok1.value.decisions).toEqual([{ at: at(80), cut: false }]);
    expect(retried.models.requests).toHaveLength(2);

    const garbage = setup(undefined, 'cloud', () => [
      { choice: GEMINI, local: false, outcome: { text: 'no' } },
    ]);
    const failed = await garbage.confirm.run({ path: PATH, candidates: [at(80)] }, testToolContext());
    expect(!failed.ok && failed.error.code).toBe('vision.model_output_invalid');
    expect(garbage.models.requests).toHaveLength(2);
  });

  it('a local registration targets only on-device models and uploads nothing', async () => {
    const { confirm, models } = setup([GEMINI, OLLAMA_VL, OLLAMA_VL_SMALL], 'local', () => [
      { choice: OLLAMA_VL, local: true, outcome: { text: '[{"row":0,"cut":true,"transition":"dissolve"}]' } },
    ]);
    const result = await confirm.run({ path: PATH, candidates: [at(144)] }, testToolContext());
    expect(result.ok && result.value).toMatchObject({
      decisions: [{ at: at(144), cut: true, transition: 'dissolve' }],
      model: { provider: 'ollama', local: true },
      uploadedTo: [],
    });
    expect(models.requests[0]?.target).toEqual(OLLAMA_VL);

    const none = setup([GEMINI], 'local');
    const refused = await none.confirm.run({ path: PATH, candidates: [at(1)] }, testToolContext());
    expect(!refused.ok && refused.error.code).toBe('vision.no_local_model');
    expect(none.models.requests).toHaveLength(0);
  });
});

describe('the job-backed tools', () => {
  it('detectCuts hands the job the options and summarises the list', async () => {
    const { detect, jobs } = setup();
    const tool = detect;
    const ctx = testToolContext();
    const result = await tool.run(tool.input.parse({ path: PATH, sensitivity: 'high' }), ctx);
    expect(result.ok && result.value).toEqual(CUT_LIST);
    expect(jobs.calls).toEqual([{ kind: 'vision.detectCuts', input: { path: PATH, sensitivity: 'high' } }]);
    expect(ctx.progress[0]).toEqual({ fraction: 0.5, note: 'making the contact sheet' });
    expect(summarizeCuts(CUT_LIST)).toBe(
      '3 cuts in 300 frames (1 soft): 1 confirmed, 2 disputed, 0 unverified.',
    );
  });

  it('readText reads all four languages at 4 frames a second by default', async () => {
    const { read, jobs } = setup();
    const tool = read;
    const result = await tool.run(tool.input.parse({ path: PATH }), testToolContext());
    expect(result.ok).toBe(true);
    expect(jobs.calls[0]?.input).toEqual({ path: PATH, fps: 4, languages: ['en', 'es', 'pt-BR', 'hi'] });
  });

  it('contactSheet with no times runs detectCuts, tiles every shot and stores the JPEG', async () => {
    const { sheet, jobs } = setup();
    const ctx = testToolContext();
    const result = await sheet.run({ path: PATH }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(jobs.calls.map((c) => c.kind)).toEqual(['vision.detectCuts', 'vision.contactSheet']);
    expect(jobs.calls[1]?.input.layout).toEqual({ kind: 'shots', cuts: [24, 80, 144] });
    expect(result.value.shots).toBe(4);
    expect(result.value.image).toMatchObject({ mediaType: 'image/jpeg', bytes: FAKE_JPEG.length });
    expect(result.value.image.summary).toMatch(/Contact sheet of 4 of 4 shots/);
    const stored = await ctx.artifacts.get(result.value.image.id as never);
    expect(stored.ok && Buffer.from(stored.value.data).equals(FAKE_JPEG)).toBe(true);
    expect(result.value.layout).toHaveLength(4);
  });

  it('contactSheet with times shows those frames', async () => {
    const { sheet, jobs } = setup();
    const result = await sheet.run({ path: PATH, at: [at(10), at(20)], columns: 2 }, testToolContext());
    expect(result.ok && result.value.shots).toBeUndefined();
    expect(jobs.calls).toEqual([
      {
        kind: 'vision.contactSheet',
        input: { path: PATH, layout: { kind: 'times', at: [at(10), at(20)] }, columns: 2 },
      },
    ]);
  });
});
