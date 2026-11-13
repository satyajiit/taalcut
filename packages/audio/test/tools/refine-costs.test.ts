// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The paid tools' closer estimates (round P3-3 `refineCost`): `voice.finalize` prices the stored draft lines,
 * `voice.editLine` the lines it would generate again, `music.generate` the track the composition plan asks for. Each
 * stays under its synchronous bound, answers an error the gate falls back from, and reads nothing once cancelled.
 */
import {
  FrameRate,
  newId,
  RationalTime,
  toolModuleProblems,
  type AnyTool,
  type VoiceLine,
  type VoiceQuality,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { musicGenerationToolModule } from '../../src/tools/music-tools';
import type { GenerationPrices } from '../../src/tools/prices';
import { voiceToolModule } from '../../src/tools/voice-read-tools';
import type { VoiceToolDeps } from '../../src/tools/voice-tools';
import { memoryTimelineStore } from '../helpers/bus';
import { makeTestTimeline } from '../helpers/timeline';

const prices: GenerationPrices = {
  voicePerCharacter: (quality) => (quality === 'final' ? 0.0001 : 0.00005),
  musicPerSecond: () => 0.0025,
  sfxPerSecond: () => 0.002,
};

const live = () => ({ signal: new AbortController().signal });

function line(text: string, quality: VoiceQuality): VoiceLine {
  return {
    id: newId<'VoiceLine'>(),
    text,
    slotId: null,
    // Not placed: the estimate reads only the words and their quality.
    clipId: null,
    assetId: null,
    quality,
    duration: RationalTime.of(48_000, FrameRate.of(48_000)),
    offBeat: false,
  };
}

function voiced(lines: VoiceLine[]) {
  return makeTestTimeline({
    clips: [{ frames: 150 }, { frames: 90 }],
    voiceover: {
      id: newId<'Voiceover'>(),
      voiceId: 'v1',
      voiceName: 'Test',
      own: false,
      language: 'en',
      seed: 7,
      lines,
    },
  });
}

const notServed = async () => {
  throw new Error('a refined estimate must not run the service');
};

function modules(timelines: VoiceToolDeps['timelines']) {
  const deps: VoiceToolDeps = {
    voiceover: { generate: notServed, editLine: notServed, place: notServed, finalize: notServed },
    provider: { voices: notServed },
    timelines,
    prices,
  };
  return [
    voiceToolModule(deps),
    musicGenerationToolModule({ generator: { generate: notServed }, timelines, prices }),
  ];
}

const tools = (timelines: VoiceToolDeps['timelines']): AnyTool[] =>
  modules(timelines).flatMap((module) => [...module.tools]);

const find = (list: AnyTool[], name: string) => {
  const tool = list.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool;
};

/** The tool's refined estimate: usd, or the error code. */
async function refined(tool: AnyTool, input: unknown, ctx = live()) {
  if (!tool.refineCost) throw new Error(`${tool.name} declares no refineCost`);
  const result = await tool.refineCost(tool.input.parse(input), ctx);
  return result.ok ? result.value : result.error.code;
}

describe('refined estimates', () => {
  const drafts = [line('Hello there', 'draft'), line('Bye', 'draft'), line('Kept final', 'final')];
  const timeline = voiced(drafts);
  const list = tools(memoryTimelineStore(timeline));
  const target = { projectId: timeline.projectId, timelineId: timeline.id };

  it('declare both the bound and the refinement, and the registry accepts them', () => {
    for (const name of ['voice.finalize', 'voice.editLine', 'music.generate']) {
      const tool = find(list, name);
      expect(tool.estimateCost, name).toBeTypeOf('function');
      expect(tool.refineCost, name).toBeTypeOf('function');
    }
    for (const module of modules(memoryTimelineStore(timeline)))
      expect(toolModuleProblems(module)).toEqual([]);
  });

  it('voice.finalize prices only the draft lines, at the final price, under its bound', async () => {
    const tool = find(list, 'voice.finalize');
    const estimate = await refined(tool, target);
    // "Hello there" and "Bye": 14 characters at 0.0001, billed as characters (review M8).
    expect(estimate).toEqual({
      usd: 0.0014,
      billed: { unit: 'character', quantity: 14 },
      basis: expect.stringContaining('2 draft lines, 14 characters'),
    });
    expect(tool.estimateCost?.(tool.input.parse(target)).usd).toBeGreaterThan(0.0014);
  });

  it('voice.editLine prices the one line with its new text, at its own quality', async () => {
    const tool = find(list, 'voice.editLine');
    const lineId = drafts[0]?.id;
    expect(await refined(tool, { ...target, lineId, text: 'Hi' })).toMatchObject({ usd: 0.0001 });
    expect(await refined(tool, { ...target, lineId })).toMatchObject({ usd: 0.00055 });
    // The stored voice again is no new voice: still one line.
    expect(await refined(tool, { ...target, lineId, voiceId: 'v1' })).toMatchObject({ usd: 0.00055 });
  });

  it('voice.editLine with a new voice prices every line at its quality', async () => {
    const tool = find(list, 'voice.editLine');
    const estimate = await refined(tool, { ...target, lineId: drafts[1]?.id, voiceId: 'v2' });
    // 14 draft characters at 0.00005 and 10 final ones at 0.0001.
    expect(estimate).toMatchObject({ usd: 0.0017, basis: expect.stringContaining('all 3 lines') });
  });

  it('voice.editLine on a final voiceover prices the line at the final price', async () => {
    const final = voiced([line('Hello there', 'final'), line('Bye', 'final')]);
    const tool = find(tools(memoryTimelineStore(final)), 'voice.editLine');
    const estimate = await refined(tool, {
      projectId: final.projectId,
      timelineId: final.id,
      lineId: final.voiceover?.lines[1]?.id,
    });
    expect(estimate).toMatchObject({ usd: 0.0003, basis: expect.stringContaining('final') });
  });

  it("music.generate prices the timeline's length and the tail", async () => {
    const tool = find(list, 'music.generate');
    // 240 frames at 30 fps is 8 s, plus the 2 s tail: 10 s at 0.0025.
    expect(await refined(tool, target)).toMatchObject({ usd: 0.025 });
    expect(tool.estimateCost?.(tool.input.parse(target)).usd).toBeGreaterThan(0.025);
  });

  it('answers an error the gate falls back from: no voiceover, an unknown line, a missing timeline', async () => {
    const bare = makeTestTimeline({ clips: [{ frames: 30 }] });
    const unvoiced = tools(memoryTimelineStore(bare));
    const bareTarget = { projectId: bare.projectId, timelineId: bare.id };
    expect(await refined(find(unvoiced, 'voice.finalize'), bareTarget)).toBe('audio.no_voiceover');
    expect(await refined(find(list, 'voice.editLine'), { ...target, lineId: newId<'VoiceLine'>() })).toBe(
      'audio.voice_line_unknown',
    );
    expect(await refined(find(list, 'music.generate'), { ...target, timelineId: newId<'Timeline'>() })).toBe(
      'core.not_found',
    );
  });

  it('reads nothing once the call is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    for (const name of ['voice.finalize', 'music.generate'])
      expect(await refined(find(list, name), target, { signal: controller.signal })).toBe('core.cancelled');
  });
});
