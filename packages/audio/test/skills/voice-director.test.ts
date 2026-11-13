// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Voice director (SPEC P3.8): its metadata registers; its check passes a placed voiceover, sends the model
 * back for a line off its beat, a missing line, drafts handed off as final or a stale revision; its card parses;
 * its estimate reads the script or the timeline's length; its coverage check reads the lines' stored transcripts.
 */
import {
  err,
  FrameRate,
  newId,
  NotFoundError,
  ok,
  RationalTime,
  skillModuleProblems,
  TimeRange,
  type AssetId,
  type RunId,
  type SkillContext,
  type SlotId,
  type Timeline,
  type Transcript,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { withRoleTrack } from '../../src/commands/audio-track';
import { createVoiceSkillModule, voiceDirectorSkill } from '../../src/skills/voice-director';
import type { TranscriptReader } from '../../src/skills/voice-coverage';
import type { GenerationPrices } from '../../src/tools/prices';
import { LINE_RATE } from '../../src/voice/alignment';
import { planPlacement } from '../../src/voice/placement';
import { voiceoverOf, type LineFacts } from '../../src/voice/voice-lines';
import { memoryTimelineStore } from '../helpers/bus';
import { makeTestTimeline, steadyBeatMap } from '../helpers/timeline';

const prices: GenerationPrices = {
  voicePerCharacter: (quality) => (quality === 'final' ? 0.00008 : 0.00004),
  musicPerSecond: () => 0.0025,
  sfxPerSecond: () => 0.002,
};

const MS = FrameRate.of(1000, 1);
const secs = (s: number) => RationalTime.of(Math.round(s * 48_000), LINE_RATE);
const slots = [newId<'TemplateSlot'>(), newId<'TemplateSlot'>()] as SlotId[];
const TEXTS = ['Three things nobody tells you.', 'Follow for more.'];

/** Two 4 s slots at 30 fps on a 120 BPM grid, with a draft voiceover placed on the beats. */
function voicedTimeline(): Timeline {
  const base = makeTestTimeline({
    rate: FrameRate.of(30),
    clips: slots.map((slotId) => ({ frames: 120, slotId })),
    beatMap: steadyBeatMap(120, 9),
  });
  const facts: LineFacts[] = slots.map((slotId, i) => ({
    lineId: newId<'VoiceLine'>(),
    slotId,
    assetId: newId<'Asset'>(),
    duration: secs(2.6),
    onset: secs(0.15),
    speechEnd: secs(2.2),
    text: TEXTS[i] ?? '',
    quality: 'draft',
  }));
  const placed = planPlacement(base, facts);
  if (!placed.ok) throw new Error(placed.error.code);
  const record = {
    id: newId<'Voiceover'>(),
    voiceId: 'v1',
    voiceName: 'Test',
    own: false,
    language: 'en',
    seed: 1,
  };
  const built = voiceoverOf(base, record, placed.value.placements, new Map(facts.map((f) => [f.lineId, f])));
  if (!built.ok) throw new Error(built.error.code);
  return {
    ...base,
    revision: 3,
    tracks: withRoleTrack(base, built.value.track),
    voiceover: built.value.voiceover,
  };
}

const ctxOf = (timeline: Timeline): SkillContext => ({
  runId: newId<'AgentRun'>() as RunId,
  projectId: timeline.projectId,
  flowId: null,
  stepId: 'voice',
  signal: new AbortController().signal,
});

function handoff(timeline: Timeline) {
  return {
    timelineId: timeline.id,
    revision: timeline.revision,
    voiceoverId: timeline.voiceover?.id ?? '',
    lines: timeline.voiceover?.lines.length ?? 0,
    quality: 'draft' as 'draft' | 'final',
    music: timeline.music.path,
    duckingMinMarginLu: null,
  };
}

async function verify(timeline: Timeline, output = handoff(timeline), transcripts?: TranscriptReader) {
  const skill = voiceDirectorSkill({
    timelines: memoryTimelineStore(timeline),
    prices,
    ...(transcripts ? { transcripts } : {}),
  });
  const verdict = await skill.verify?.(output, ctxOf(timeline));
  if (!verdict?.ok) throw new Error('verify failed to run');
  return verdict.value;
}

describe('the Voice director', () => {
  it('registers: id, version, tools and schemas the agent accepts', () => {
    const module = createVoiceSkillModule({ timelines: memoryTimelineStore(), prices });
    expect(skillModuleProblems(module)).toEqual([]);
    expect(module.skills.map((s) => s.id)).toEqual(['voice.director']);
  });

  it('passes a voiceover placed on the beats at the stored revision', async () => {
    expect(await verify(voicedTimeline())).toEqual({ verdict: 'pass' });
  });

  it('sends the model back when an onset sits off its beat and is not flagged', async () => {
    const timeline = voicedTimeline();
    const voice = timeline.tracks.find((t) => t.kind === 'audio' && t.role === 'voice');
    if (voice?.kind !== 'audio') throw new Error('no voice track');
    // The item before the second line three frames longer, the line three frames shorter: it starts late.
    const second = voice.items.findLastIndex((item) => item.type === 'clip');
    const before = voice.items[second - 1];
    const line = voice.items[second];
    if (!before || before.type === 'transition' || line?.type !== 'clip')
      throw new Error('two lines expected');
    const three = RationalTime.of(3, line.duration.rate);
    const nudged = voice.items.map((item, i) =>
      i === second - 1 && item.type !== 'transition'
        ? { ...item, duration: RationalTime.add(item.duration, three) }
        : i === second
          ? { ...line, duration: RationalTime.subtract(line.duration, three) }
          : item,
    );
    const moved = {
      ...timeline,
      tracks: timeline.tracks.map((t) => (t === voice ? { ...voice, items: nudged } : t)),
    };
    const verdict = await verify(moved);
    expect(verdict).toMatchObject({
      verdict: 'retry',
      reason: expect.stringMatching(/frames from its beat: call voice.place/),
    });
  });

  it('sends the model back for a stale revision, a missing line or drafts handed off as final', async () => {
    const timeline = voicedTimeline();
    expect(await verify(timeline, { ...handoff(timeline), revision: 2 })).toMatchObject({ verdict: 'retry' });
    expect(await verify(timeline, { ...handoff(timeline), lines: 3 })).toMatchObject({
      verdict: 'retry',
      reason: expect.stringMatching(/2 lines, not 3/),
    });
    expect(await verify(timeline, { ...handoff(timeline), quality: 'final' })).toMatchObject({
      verdict: 'retry',
      reason: expect.stringMatching(/voice.finalize/),
    });
    const unvoiced = { ...timeline, voiceover: null };
    expect(await verify(unvoiced, handoff(timeline))).toMatchObject({ verdict: 'retry' });
  });

  it('shows the voiceover card with what the takes cost and what final would cost', async () => {
    const timeline = voicedTimeline();
    const skill = voiceDirectorSkill({ timelines: memoryTimelineStore(timeline), prices });
    const card = await skill.card?.(handoff(timeline), ctxOf(timeline));
    const characters = TEXTS.join('').length;
    expect(card?.ok && card.value).toMatchObject({
      type: 'voiceover',
      quality: 'draft',
      spent: { currency: 'USD', micros: Math.round(characters * 0.00004 * 1_000_000) },
      finalizeEstimate: { currency: 'USD', micros: Math.round(characters * 0.00008 * 1_000_000) },
      ducking: null,
    });
  });

  it("estimates a given script, or the timeline's length when there is none, plus music when asked", async () => {
    const timeline = voicedTimeline();
    const skill = voiceDirectorSkill({ timelines: memoryTimelineStore(timeline), prices });
    const target = { projectId: timeline.projectId, timelineId: timeline.id };
    const given = await skill.estimate?.({ ...target, script: ['a'.repeat(100)] }, ctxOf(timeline));
    expect(given?.ok && given.value.usd).toBeCloseTo(100 * (0.00004 + 0.00008), 9);
    const guessed = await skill.estimate?.({ ...target, music: 'generate' }, ctxOf(timeline));
    // 8 s at 2.7 words a second and 6 characters a word; 10 s of music.
    expect(guessed?.ok && guessed.value.usd).toBeCloseTo(130 * (0.00004 + 0.00008) + 10 * 0.0025, 6);
  });
});

/** A line's stored transcript saying `text` (engine tts, one segment). */
function said(text: string): Transcript {
  const range = TimeRange.of(RationalTime.of(0, MS), RationalTime.of(100, MS));
  return {
    version: 1,
    language: 'en',
    engine: 'tts',
    model: 'eleven_v4',
    local: false,
    wordTiming: 'native',
    segments: [
      {
        text,
        range,
        language: 'en',
        words: text.split(' ').map((word) => ({ text: word, range, confidence: 1 })),
      },
    ],
  };
}

/** Transcripts by line: a text, null (none stored) or 'error' (the read fails). */
function reader(
  timeline: Timeline,
  byLine: (string | null | 'error')[],
): TranscriptReader & { reads: number } {
  const byAsset = new Map(timeline.voiceover?.lines.map((line, i) => [line.assetId, byLine[i]]));
  const source = {
    reads: 0,
    async transcript(assetId: AssetId) {
      source.reads += 1;
      const text = byAsset.get(assetId);
      if (text === 'error') return err(NotFoundError({ entity: 'asset', id: assetId }));
      return ok(text ? said(text) : null);
    },
  };
  return source;
}

describe("the Voice director's coverage check", () => {
  it("passes when the lines' transcripts say the script, punctuation and case aside", async () => {
    const timeline = voicedTimeline();
    const transcripts = reader(timeline, ['three things Nobody tells you', 'Follow for more']);
    expect(await verify(timeline, handoff(timeline), transcripts)).toEqual({ verdict: 'pass' });
    expect(transcripts.reads).toBe(2);
  });

  it('sends the model back when the words cover less than 98 % of the script, naming the line', async () => {
    const timeline = voicedTimeline();
    // "nobody" is 6 of the 38 graphemes of the script's words: 84.2 %.
    const verdict = await verify(
      timeline,
      handoff(timeline),
      reader(timeline, ['Three things tells you', 'Follow for more']),
    );
    expect(verdict).toMatchObject({
      verdict: 'retry',
      reason: expect.stringMatching(/84\.2 % .*Line 1 misses "nobody": call voice\.editLine/),
    });
  });

  it("doesn't fail on coverage alone when a transcript can't be read, and says so only when it matters", async () => {
    const timeline = voicedTimeline();
    for (const lines of [
      [null, null],
      [null, 'Follow for more'],
      ['error', 'Follow for more'],
    ] as const)
      expect(await verify(timeline, handoff(timeline), reader(timeline, [...lines]))).toEqual({
        verdict: 'pass',
      });
    const short = await verify(timeline, handoff(timeline), reader(timeline, [null, 'Follow']));
    expect(short).toMatchObject({
      verdict: 'retry',
      reason: expect.stringMatching(
        /\(1 line had no stored transcript to check\)\. Line 2 misses "for", "more"/,
      ),
    });
  });

  it('checks the handoff first and reads no transcript when it already fails', async () => {
    const timeline = voicedTimeline();
    const transcripts = reader(timeline, ['Three', 'Follow']);
    expect(await verify(timeline, { ...handoff(timeline), revision: 2 }, transcripts)).toMatchObject({
      verdict: 'retry',
      reason: expect.stringMatching(/revision 3/),
    });
    expect(transcripts.reads).toBe(0);
  });
});
