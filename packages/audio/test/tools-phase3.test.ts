// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Audio's Phase 3 tools (SPEC P3.9): metadata the registry accepts, paid tools that estimate and declare the
 * internet (so Local only refuses them before they run), local tools that don't, and each tool's run against fake
 * services: what it dispatches, what it reports and what it hands back.
 */
import {
  defineToolModule,
  err,
  FrameRate,
  MIX_COMMANDS,
  MUSIC_COMMANDS,
  newId,
  NotFoundError,
  ok,
  RationalTime,
  toolModuleProblems,
  VOICE_COMMANDS,
  type AnyTool,
  type CommandToolContext,
  type JobRunner,
  type Timeline,
  type ToolModule,
  type ToolUsage,
  type VoiceConsent,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { NoTranscript } from '../src/cleanup/errors';
import { cleanupTools } from '../src/tools/cleanup-tools';
import { musicGenerationToolModule } from '../src/tools/music-tools';
import type { GenerationPrices } from '../src/tools/prices';
import { sfxToolModule } from '../src/tools/sfx-tools';
import { voiceToolModule } from '../src/tools/voice-read-tools';
import type { VoiceoverOutcome } from '../src/voice/voiceover';
import { memoryTimelineStore } from './helpers/bus';
import { makeTestTimeline } from './helpers/timeline';

const prices: GenerationPrices = {
  voicePerCharacter: (quality) => (quality === 'final' ? 0.00008 : 0.00004),
  musicPerSecond: () => 0.0025,
  sfxPerSecond: () => 0.002,
};

function context(): CommandToolContext & { dispatched: unknown[]; usage: ToolUsage[] } {
  const dispatched: unknown[] = [];
  const usage: ToolUsage[] = [];
  return {
    dispatched,
    usage,
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    runId: newId<'AgentRun'>(),
    attempt: 1,
    artifacts: {
      put: async () => err(NotFoundError({ entity: 'artifact' })),
      get: async () => err(NotFoundError({ entity: 'artifact' })),
    },
    reportUsage: (used) => usage.push(used),
    reportProgress: () => undefined,
    dispatch: async (payload) => {
      dispatched.push(payload);
      return ok({ timelineId: 'x', revision: 2 });
    },
  };
}

const timeline = makeTestTimeline({ clips: [{ frames: 90 }, { frames: 90 }, { frames: 60 }] });
const store = () => memoryTimelineStore(timeline);
const target = { projectId: timeline.projectId, timelineId: timeline.id };

function outcome(costUsd: number): VoiceoverOutcome {
  const lineId = newId<'VoiceLine'>();
  return {
    payload: {
      ...target,
      revision: 1,
      voiceover: {
        id: newId<'Voiceover'>(),
        voiceId: 'v1',
        voiceName: 'Test',
        own: false,
        language: 'en',
        seed: 7,
        lines: [
          {
            id: lineId,
            text: 'Hello there.',
            slotId: null,
            clipId: newId<'TimelineItem'>(),
            assetId: newId<'Asset'>(),
            quality: 'draft',
            duration: RationalTime.of(43_200, FrameRate.of(48_000)),
            offBeat: false,
          },
        ],
      },
      track: { kind: 'audio', id: 'A2', name: 'Voice', enabled: true, role: 'voice', items: [] },
    },
    lines: [{ lineId, start: RationalTime.of(12, FrameRate.of(30)), offBeat: false }],
    warnings: [],
    costUsd,
  };
}

function voiceDeps(consents: VoiceConsent[] = []) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      voiceover: {
        generate: async () => (calls.push('generate'), ok(outcome(0.0005))),
        editLine: async () => (calls.push('editLine'), ok(outcome(0.0004))),
        place: async () => (calls.push('place'), ok(outcome(0))),
        finalize: async () => (calls.push('finalize'), ok(outcome(0.001))),
      },
      provider: {
        voices: async () =>
          ok([{ voiceId: 'v1', name: 'Test voice', labels: { accent: 'indian' }, own: false }]),
      },
      timelines: store(),
      prices,
      consents: { list: async () => ok(consents) },
    },
  };
}

const find = (module: ToolModule, name: string): AnyTool => {
  const tool = module.tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no ${name}`);
  return tool;
};

const jobs: JobRunner = { run: async () => err(NotFoundError({ entity: 'job kind' })) };
const modules = (): ToolModule[] => [
  voiceToolModule(voiceDeps().deps),
  musicGenerationToolModule({
    generator: { generate: async () => err(NotFoundError({ entity: 'x' })) },
    timelines: store(),
    prices,
  }),
  sfxToolModule({
    service: {
      addHits: async () => err(NotFoundError({ entity: 'x' })),
      generateHit: async () => err(NotFoundError({ entity: 'x' })),
    },
    timelines: store(),
    prices,
  }),
  defineToolModule({ id: 'audio', tools: cleanupTools({ jobs, timelines: store() }) }),
];

describe('audio Phase 3 tool metadata', () => {
  it('passes the registry checks', () => {
    for (const module of modules()) expect(toolModuleProblems(module)).toEqual([]);
  });

  it('declares the internet and an estimate on every paid tool, nothing on local ones', () => {
    const tools = modules().flatMap((module) => module.tools);
    expect(tools.map((t) => t.name).sort()).toEqual([
      'audio.analyzeCleanup',
      'music.generate',
      'music.setDucking',
      'sfx.addHits',
      'sfx.generateHit',
      'voice.editLine',
      'voice.finalize',
      'voice.fitScript',
      'voice.generate',
      'voice.listVoices',
      'voice.place',
    ]);
    for (const tool of tools) {
      if (tool.costClass === 'local') expect(tool.permission?.network, tool.name).toBe('none');
      else {
        expect(tool.permission?.network, tool.name).toBe('internet');
        expect(tool.permission?.cloudModules?.length, tool.name).toBe(1);
        expect(tool.estimateCost, tool.name).toBeTypeOf('function');
      }
      if (tool.sideEffect === 'write') expect(tool.idempotencyKey, tool.name).toBeTypeOf('function');
      expect(['external', 'destructive']).not.toContain(tool.sideEffect);
    }
  });

  it('estimates the script at the draft price, and bounds what it cannot read', () => {
    const voice = voiceToolModule(voiceDeps().deps);
    const estimate = find(voice, 'voice.generate').estimateCost?.({
      ...target,
      lines: [{ text: 'a'.repeat(100) }, { text: 'b'.repeat(50) }],
      voiceId: 'v1',
      language: 'en',
    });
    expect(estimate?.usd).toBeCloseTo(150 * 0.00004, 9);
    expect(find(voice, 'voice.finalize').estimateCost?.(target)?.basis).toMatch(/at most 3000/);
  });
});

describe('voice tools', () => {
  it('generates, reports the cost and applies the payload with voice.applyVoiceover', async () => {
    const { deps, calls } = voiceDeps();
    const tool = find(voiceToolModule(deps), 'voice.generate');
    expect(tool.command).toBe(VOICE_COMMANDS.applyVoiceover);
    const ctx = context();
    const done = await tool.run(
      { ...target, lines: [{ text: 'Hello there.' }], voiceId: 'v1', language: 'en' },
      ctx,
    );
    expect(done.ok).toBe(true);
    expect(calls).toEqual(['generate']);
    expect(ctx.usage).toEqual([{ usd: 0.0005 }]);
    expect(ctx.dispatched).toHaveLength(1);
    if (done.ok)
      expect(done.value).toMatchObject({
        quality: 'draft',
        lines: [{ startMs: 400, durationMs: 900, offBeat: false }],
      });
  });

  it('refuses a voice the provider does not have, before paying for anything', async () => {
    const { deps, calls } = voiceDeps();
    const ctx = context();
    const done = await find(voiceToolModule(deps), 'voice.generate').run(
      { ...target, lines: [{ text: 'Hi.' }], voiceId: 'someone-famous', language: 'en' },
      ctx,
    );
    expect(done.ok ? 'ok' : done.error.code).toBe('core.validation');
    expect(calls).toEqual([]);
    expect(ctx.dispatched).toEqual([]);
  });

  it("lists voices with the user's own clone marked from their consent", async () => {
    const consent = { clone: { provider: 'elevenlabs', voiceId: 'v1', createdAt: 1 } } as VoiceConsent;
    const done = await find(voiceToolModule(voiceDeps([consent]).deps), 'voice.listVoices').run(
      {},
      context(),
    );
    expect(done.ok && done.value).toEqual({
      voices: [{ voiceId: 'v1', name: 'Test voice', labels: { accent: 'indian' }, own: true }],
    });
  });

  it('fits a script against the slots without a model call', async () => {
    const done = await find(voiceToolModule(voiceDeps().deps), 'voice.fitScript').run(
      {
        ...target,
        lines: [{ text: 'One two three four five six seven eight nine ten eleven twelve.' }],
        language: 'en',
      },
      context(),
    );
    // Twelve words at 2.7 a second: about 4.4 s, and the clips have no slot for the line to sit in.
    expect(done.ok && done.value).toMatchObject({
      lines: [{ estimatedMs: 4444, slotMs: 0, overByMs: 4444 }],
    });
  });

  it('places and finalises through the same command; a missing timeline stops before the service', async () => {
    const { deps, calls } = voiceDeps();
    const module = voiceToolModule(deps);
    await find(module, 'voice.place').run(target, context());
    await find(module, 'voice.finalize').run(target, context());
    const missing = await find(module, 'voice.place').run(
      { ...target, timelineId: newId<'Timeline'>() },
      context(),
    );
    expect(calls).toEqual(['place', 'finalize']);
    expect(missing.ok ? 'ok' : missing.error.code).toBe('core.not_found');
  });
});

describe('music, ducking and sound-effect tools', () => {
  it('chooses a generated track with music.choosePath and reports its cost', async () => {
    const assetId = newId<'Asset'>();
    const module = musicGenerationToolModule({
      generator: {
        generate: async () =>
          ok({
            choice: {
              path: 'generated',
              assetId,
              warpedKey: 'warped/ab/x.v1.flac',
              bpm: 96,
              grid: { maxErrorMs: 20, p95ErrorMs: 12, missed: 0 },
              gainDb: -12,
            },
            assetId,
            bpm: 96,
            grid: { maxErrorMs: 20, p95ErrorMs: 12, missed: 0, passed: true } as never,
            warped: true,
            attempts: 1,
            costUsd: 0.07,
          }),
      },
      timelines: store(),
      prices,
    });
    const tool = find(module, 'music.generate');
    expect(tool.command).toBe(MUSIC_COMMANDS.choosePath);
    const ctx = context();
    const done = await tool.run({ ...target, mood: ['warm'] }, ctx);
    expect(done.ok && done.value).toMatchObject({ path: 'generated', bpm: 96, warped: true, costUsd: 0.07 });
    expect(ctx.dispatched[0]).toMatchObject({ ...target, choice: { path: 'generated', assetId } });
    expect(ctx.usage).toEqual([{ usd: 0.07 }]);
  });

  it('sends only the ducking fields asked for and answers with the result', async () => {
    const module = musicGenerationToolModule({
      generator: { generate: async () => err(NotFoundError({ entity: 'x' })) },
      timelines: store(),
      prices,
    });
    const tool = find(module, 'music.setDucking');
    expect(tool.command).toBe(MIX_COMMANDS.setDucking);
    const ctx = context();
    const done = await tool.run({ ...target, marginLu: 10 }, ctx);
    expect(ctx.dispatched).toEqual([{ ...target, ducking: { marginLu: 10 } }]);
    expect(done.ok && done.value).toEqual({ enabled: true, marginLu: 10 });
    expect(tool.input.safeParse(target).success).toBe(false);
  });

  it('puts pack hits on cuts with sfx.setHits', async () => {
    const hits = [{ id: newId<'TimelineItem'>() }, { id: newId<'TimelineItem'>() }];
    const module = sfxToolModule({
      service: {
        addHits: async () => ok({ payload: { ...target, revision: 1, hits: hits as never }, costUsd: 0 }),
        generateHit: async () => err(NotFoundError({ entity: 'x' })),
      },
      timelines: store(),
      prices,
    });
    const ctx = context();
    const done = await find(module, 'sfx.addHits').run({ ...target, density: 'everyCut' }, ctx);
    expect(done.ok && done.value).toEqual({ hits: 2 });
    expect(ctx.usage).toEqual([]);
    expect(ctx.dispatched).toHaveLength(1);
  });
});

describe('audio.analyzeCleanup', () => {
  it("analyses each clip's asset once, listing assets with no transcript as missing", async () => {
    const three = makeTestTimeline({ clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }] });
    const video = three.tracks[0];
    if (video?.kind !== 'video') throw new Error('no video track');
    const [first, second, third] = video.items;
    if (first?.type !== 'clip' || second?.type !== 'clip' || third?.type !== 'clip') throw new Error('clips');
    // The third clip is another part of the first clip's asset.
    const items = [first, second, { ...third, media: { ...third.media, assetId: first.media.assetId } }];
    const twice: Timeline = { ...three, tracks: [{ ...video, items }] };
    const [a, b] = [first.media.assetId, second.media.assetId];
    const runs: string[] = [];
    const runner: JobRunner = {
      run: async (_kind, input) => {
        const { assetId } = input as { assetId: string };
        runs.push(assetId);
        if (assetId === b) return err(NoTranscript({ assetId }));
        return ok({
          key: 'k',
          reused: false,
          fillers: 3,
          pauses: 2,
          retakes: 1,
          emphasis: 1,
          ambiguous: 4,
        } as never);
      },
    };
    const tool = cleanupTools({ jobs: runner, timelines: memoryTimelineStore(twice) })[0];
    if (!tool) throw new Error('no tool');
    const done = await tool.run({ projectId: twice.projectId, timelineId: twice.id }, context());
    expect(done.ok && done.value).toMatchObject({
      assets: [{ assetId: a, fillers: 3, pauses: 2, retakes: 1, emphasis: 1, ambiguous: 4 }],
      missing: [b],
    });
    expect(runs).toEqual([a, b]);
    const only = await tool.run(
      { projectId: twice.projectId, timelineId: twice.id, clipIds: [first.id] },
      context(),
    );
    expect(only.ok && only.value).toEqual({ assets: [expect.objectContaining({ assetId: a })], missing: [] });
  });

  it('passes on any other job failure', async () => {
    const failing: JobRunner = { run: async () => err(NotFoundError({ entity: 'job kind' })) };
    const [tool] = cleanupTools({ jobs: failing, timelines: store() });
    const done = await tool?.run(target, context());
    expect(done && !done.ok && done.error.code).toBe('core.not_found');
  });
});
