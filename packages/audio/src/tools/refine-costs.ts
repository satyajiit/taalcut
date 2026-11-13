// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The closer estimates (`refineCost`, round P3-3) of the paid tools whose cost depends on the stored timeline. Each
 * tool's synchronous `estimateCost` stays the bound (ESTIMATE_BOUNDS); the budget gate awaits these with the call's
 * signal and uses them in its place when they answer ok, so the user is asked about what the call will really
 * spend: the draft lines `voice.finalize` makes final, the lines `voice.editLine` generates again, the track
 * `music.generate` composes. Read-only, and priced the same way as the run (the voiceover service's lines, the
 * composition plan's length).
 */
import {
  CancelledError,
  err,
  ok,
  type AsyncResult,
  type Result,
  type Timeline,
  type TimelineStore,
  type ToolCostEstimate,
  type ToolEstimateContext,
  type VoiceLineId,
  type Voiceover,
} from '@taalcut/core';
import { readTimeline, type TimelineTarget } from '../commands/timeline-writes';
import { MUSIC_CONFIG } from '../music/config';
import { timelineMs } from '../timeline/span';
import { NoVoiceover, VoiceLineUnknown } from '../voice/errors';
import { musicEstimate, voiceEstimate, type GenerationPrices } from './prices';

export interface RefineDeps {
  readonly timelines: TimelineStore;
  readonly prices: GenerationPrices;
}

const toMicros = (usd: number) => Math.round(usd * 1_000_000) / 1_000_000;

async function readFor(
  deps: RefineDeps,
  target: TimelineTarget,
  ctx: ToolEstimateContext,
): AsyncResult<Timeline> {
  if (ctx.signal.aborted) return err(CancelledError());
  return readTimeline(deps.timelines, { projectId: target.projectId, timelineId: target.timelineId });
}

function voiceoverOf(timeline: Timeline): Result<Voiceover> {
  const voiceover = timeline.voiceover;
  return voiceover && voiceover.lines.length > 0 ? ok(voiceover) : err(NoVoiceover());
}

/** `voice.finalize`: every draft line's characters at the final price; nothing when every line is final. */
export async function refineFinalizeCost(
  deps: RefineDeps,
  input: TimelineTarget,
  ctx: ToolEstimateContext,
): AsyncResult<ToolCostEstimate> {
  const timeline = await readFor(deps, input, ctx);
  if (!timeline.ok) return timeline;
  const voiceover = voiceoverOf(timeline.value);
  if (!voiceover.ok) return voiceover;
  const drafts = voiceover.value.lines.filter((line) => line.quality === 'draft');
  const characters = drafts.reduce((sum, line) => sum + line.text.length, 0);
  return ok(
    voiceEstimate(
      deps.prices,
      characters,
      'final',
      `${drafts.length} draft lines, ${characters} characters at the final model's list price`,
    ),
  );
}

/**
 * `voice.editLine`: the line again with its new text, final once the whole voiceover is; a voice other than the
 * stored one generates every line again, each at its own quality (the voiceover service's `editLine`).
 */
export async function refineEditLineCost(
  deps: RefineDeps,
  input: TimelineTarget & { readonly lineId: VoiceLineId; readonly text?: string; readonly voiceId?: string },
  ctx: ToolEstimateContext,
): AsyncResult<ToolCostEstimate> {
  const timeline = await readFor(deps, input, ctx);
  if (!timeline.ok) return timeline;
  const voiceover = voiceoverOf(timeline.value);
  if (!voiceover.ok) return voiceover;
  const lines = voiceover.value.lines;
  const index = lines.findIndex((line) => line.id === input.lineId);
  if (index < 0) return err(VoiceLineUnknown({ lineId: input.lineId }));
  const final = lines.every((line) => line.quality === 'final');
  const everyLine = input.voiceId !== undefined && input.voiceId !== voiceover.value.voiceId;
  let usd = 0;
  let characters = 0;
  for (const [i, line] of lines.entries()) {
    if (!everyLine && i !== index) continue;
    const text = i === index ? (input.text ?? line.text) : line.text;
    const quality = i === index && final ? 'final' : line.quality;
    characters += text.length;
    usd += voiceEstimate(deps.prices, text.length, quality, '').usd;
  }
  const quality = final ? 'final' : (lines[index]?.quality ?? 'draft');
  const basis = everyLine
    ? `a new voice: all ${lines.length} lines, ${characters} characters, each at its quality's list price`
    : `one line, ${characters} characters at the ${quality} model's list price`;
  return ok({ usd: toMicros(usd), billed: { unit: 'character', quantity: characters }, basis });
}

/** `music.generate`: one track the timeline's length plus the outro tail (the composition plan's length). */
export async function refineMusicCost(
  deps: RefineDeps,
  input: TimelineTarget,
  ctx: ToolEstimateContext,
): AsyncResult<ToolCostEstimate> {
  const timeline = await readFor(deps, input, ctx);
  if (!timeline.ok) return timeline;
  const seconds = Math.round(timelineMs(timeline.value) + MUSIC_CONFIG.tailMs) / 1000;
  return ok(
    musicEstimate(
      deps.prices,
      seconds,
      `${seconds.toFixed(1)} s of music (the timeline and the tail) at the estimated price; a second attempt, ` +
        'when the first is off the grid, costs the same again',
    ),
  );
}
