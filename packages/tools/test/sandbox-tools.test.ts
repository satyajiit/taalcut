// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The `sandbox` agent tools and the recipes behind them. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  err,
  newId,
  NotFoundError,
  ok,
  toolModuleProblems,
  type AssetId,
  type ExperimentSandbox,
  type SandboxRunRequest,
  type ToolContextBase,
} from '@taalcut/core';
import {
  createMemoryArtifactStore,
  createToolRegistry,
  recipeParamsSchemas,
  recipeRequest,
  SANDBOX_RECIPES,
  sandboxRecipeSchema,
  sandboxToolModule,
} from '@taalcut/tools';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareRun } from '../src/sandbox/validate';
import { confinedSkipReason, execSandbox, experimentId, skipMessage, tempRoot } from './helpers/sandbox';

const skip = confinedSkipReason();
skipMessage('sandbox recipes (real FFmpeg)', skip);

function fakeSandbox() {
  const runs: SandboxRunRequest[] = [];
  const sandbox: ExperimentSandbox = {
    open: async () => err(NotFoundError()),
    get: async () => err(NotFoundError()),
    run: async (_id, request) => {
      runs.push(request);
      return ok({
        exitCode: 0,
        stdout: 'out',
        stderrTail: '',
        durationMs: 3,
        written: [{ path: 'f.jpg', bytes: 9 }],
      });
    },
    list: async () => ok([{ path: 'f.jpg', bytes: 9, kind: 'file' as const }]),
    readText: async (_id, path) => (path === 'missing' ? err(NotFoundError()) : ok('text')),
    discard: async () => ok({ freedBytes: 0 }),
    sweep: async () => ok({ removed: [] }),
  };
  return { sandbox, runs };
}

const asset = newId<'Asset'>();
const resolveInput = async (id: AssetId) => (id === asset ? ok('/library/clip.mov') : err(NotFoundError()));
const ctx = (): ToolContextBase => ({
  signal: new AbortController().signal,
  callId: newId<'ToolRun'>(),
  attempt: 1,
  artifacts: createMemoryArtifactStore(),
  reportUsage: () => undefined,
  reportProgress: () => undefined,
});

describe('sandbox tools', () => {
  const { sandbox, runs } = fakeSandbox();
  const module = sandboxToolModule({ sandbox, resolveInput });
  const tool = (name: string) => module.tools.find((t) => t.name === name)!;

  it('declare full metadata, register, and export JSON schemas', () => {
    expect(toolModuleProblems(module)).toEqual([]);
    const registry = createToolRegistry([module]);
    expect(registry.ok && registry.value.resolve('sandbox.run')).toBeTruthy();
    const schemas = registry.ok ? registry.value.loadSchemas(['sandbox.run', 'sandbox.files']) : null;
    expect(schemas?.ok).toBe(true);
    expect(tool('sandbox.run')).toMatchObject({ costClass: 'local', sideEffect: 'read', timeoutMs: 130_000 });
    expect(tool('sandbox.run').permission).toEqual({
      filesystem: { read: ['scratch', 'library'], write: ['scratch'] },
      network: 'none',
    });
    for (const t of module.tools) {
      expect(() => z.toJSONSchema(t.input, { io: 'input' })).not.toThrow();
      expect(() => z.toJSONSchema(t.output, { io: 'output' })).not.toThrow();
    }
  });

  it('runs a program offline with granted inputs, and never the fetcher', async () => {
    const experimentId = newId<'Experiment'>();
    const input = tool('sandbox.run').input.parse({
      experimentId,
      program: 'ffprobe',
      args: ['input:0'],
      inputs: [asset],
    });
    const result = await tool('sandbox.run').run(input, ctx());
    expect(result.ok && result.value).toMatchObject({ exitCode: 0, stdout: 'out' });
    expect(runs.at(-1)).toEqual({
      program: 'ffprobe',
      args: ['input:0'],
      inputs: ['/library/clip.mov'],
      network: 'none',
    });
    expect(tool('sandbox.run').input.safeParse({ experimentId, program: 'ytDlp', args: [] }).success).toBe(
      false,
    );
    expect(
      tool('sandbox.run').input.safeParse({ experimentId, program: 'ffmpeg', recipe: 'probe' }).success,
    ).toBe(false);
    const unknown = tool('sandbox.run').input.parse({
      experimentId,
      program: 'ffprobe',
      args: [],
      inputs: [newId<'Asset'>()],
    });
    expect((await tool('sandbox.run').run(unknown, ctx())).ok).toBe(false);
    expect(
      tool('sandbox.run').summarize?.({
        exitCode: 1,
        stdout: '',
        stderrTail: '',
        durationMs: 5,
        written: [],
      }),
    ).toBe('exit 1 in 5 ms, 0 files written');
  });

  it('runs a recipe from parameters and refuses bad ones', async () => {
    const experimentId = newId<'Experiment'>();
    const input = tool('sandbox.run').input.parse({
      experimentId,
      recipe: 'probe',
      params: { input: 'scratch:clip.mp4' },
    });
    expect((await tool('sandbox.run').run(input, ctx())).ok).toBe(true);
    expect(runs.at(-1)?.program).toBe('ffprobe');
    const bad = tool('sandbox.run').input.parse({
      experimentId,
      recipe: 'frames',
      params: { input: '/etc/passwd' },
    });
    const refused = await tool('sandbox.run').run(bad, ctx());
    expect(!refused.ok && refused.error.code).toBe('core.validation');
  });

  it('lists and reads files', async () => {
    const experimentId = newId<'Experiment'>();
    const files = tool('sandbox.files');
    const listing = await files.run(files.input.parse({ experimentId }), ctx());
    expect(listing.ok && listing.value).toEqual({
      kind: 'listing',
      files: [{ path: 'f.jpg', bytes: 9, kind: 'file' }],
    });
    const text = await files.run(files.input.parse({ experimentId, read: 'scores.txt' }), ctx());
    expect(text.ok && text.value).toEqual({ kind: 'text', path: 'scores.txt', text: 'text' });
    expect((await files.run(files.input.parse({ experimentId, read: 'missing' }), ctx())).ok).toBe(false);
    expect(files.input.safeParse({ experimentId, dir: 'a', read: 'b' }).success).toBe(false);
  });
});

describe('recipes', () => {
  let temp: { root: string; cleanup: () => void };
  let dir: string;
  beforeEach(() => {
    temp = tempRoot();
    dir = join(temp.root, 'exp');
    mkdirSync(dir);
    writeFileSync(join(dir, 'clip.mp4'), 'x');
    writeFileSync(join(dir, 'f.png'), 'x');
  });
  afterEach(() => temp.cleanup());

  const calls = {
    frames: { input: 'scratch:clip.mp4', times: [0, 1.5] },
    sceneScores: { input: 'input:0', start: 1, duration: 2 },
    signalStats: { input: 'scratch:clip.mp4', keys: ['YAVG', 'YMAX'] },
    loudness: { input: 'scratch:clip.mp4' },
    ocr: { input: 'scratch:f.png', languages: ['en-US', 'hi'], fast: true },
    probe: { input: 'scratch:clip.mp4' },
  };

  it('every recipe builds a request the validator accepts', async () => {
    for (const recipe of SANDBOX_RECIPES) {
      const call = sandboxRecipeSchema.parse({ recipe, params: calls[recipe] });
      const request = recipeRequest(call);
      const prepared = await prepareRun(
        { ...request, inputs: [join(dir, 'clip.mp4')] },
        { dir, programs: { ffmpeg: '/bin/echo', ffprobe: '/bin/echo', macHelper: '/bin/echo' }, threads: 2 },
      );
      expect(prepared.ok, `${recipe}: ${JSON.stringify(!prepared.ok && prepared.error)}`).toBe(true);
    }
    const fps = recipeRequest(
      sandboxRecipeSchema.parse({
        recipe: 'frames',
        params: { input: 'scratch:clip.mp4', fps: 2, format: 'png' },
      }),
    );
    expect(fps.args.at(-1)).toBe('scratch:frames/frame_%04d.png');
    expect(recipeParamsSchemas.frames.safeParse({ input: 'scratch:a', times: [1], fps: 1 }).success).toBe(
      false,
    );
  });

  it.skipIf(skip !== '')(
    'sceneScores finds the cut in a two-colour clip with the real FFmpeg',
    async () => {
      const { sandbox } = execSandbox(join(temp.root, 'root'));
      const id = experimentId();
      await sandbox.open({ id, projectId: null, purpose: 'analysis' });
      const make = await sandbox.run(id, {
        program: 'ffmpeg',
        args: [
          '-f',
          'lavfi',
          '-i',
          'color=red:size=128x128:rate=25:duration=1',
          '-f',
          'lavfi',
          '-i',
          'color=blue:size=128x128:rate=25:duration=1',
          '-filter_complex',
          '[0:v][1:v]concat=n=2:v=1:a=0[v]',
          '-map',
          '[v]',
          '-c:v',
          'h264_videotoolbox',
          'scratch:cut.mp4',
        ],
      });
      expect(make.ok && make.value.exitCode).toBe(0);
      const scores = await sandbox.run(
        id,
        recipeRequest(
          sandboxRecipeSchema.parse({ recipe: 'sceneScores', params: { input: 'scratch:cut.mp4' } }),
        ),
      );
      expect(scores.ok && scores.value.exitCode).toBe(0);
      expect(scores.ok && scores.value.stdout).toMatch(/pts_time:1\b[\s\S]*lavfi\.scd\.score=/);
      const frames = await sandbox.run(
        id,
        recipeRequest(
          sandboxRecipeSchema.parse({
            recipe: 'frames',
            params: { input: 'scratch:cut.mp4', times: [0.5, 1.5] },
          }),
        ),
      );
      expect(frames.ok && frames.value.written.map((file) => file.path)).toEqual([
        'frames/t00.jpg',
        'frames/t01.jpg',
      ]);
    },
    120_000,
  );
});
