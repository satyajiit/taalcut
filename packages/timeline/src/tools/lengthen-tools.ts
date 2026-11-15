// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: the tools a video is made longer with. A video made from a reel was exactly the reel's length; the owner's
 * hand-made version let the person's shot run two bars longer by playing two bars of the reel's music again, and
 * everything after stayed on its music.
 *
 * - `timeline.musicBars` reads. The music: the bar's length and each bar line in seconds of the video, how sure the
 *   measurement is, and where the music changes strongly, measured from the reel's samples (reel-music.ts; no
 *   model). The clips: where each sits, how long it is, how much of its shot lies before and after what it plays,
 *   and the instant on its cut where its slot states one (MATCH1). With `would`, what a stated lengthening would
 *   do, without doing it.
 * - `timeline.lengthenSlot` writes one lengthening as stated: whole bars, at a bar line, the length rounded to whole
 *   frames once and used for picture and sound. It answers the same numbers `would` gave. What can't be done as
 *   stated changes nothing and says why with the numbers.
 *
 * Nothing here decides whether a video should be longer, which clip, by how many bars or where the music repeats:
 * the tools report, the model states. The words are kept short: a step in a small window loads these schemas whole.
 */
import {
  defineTool,
  err,
  FrameRate,
  LENGTHEN_SLOT_COMMAND,
  lengthenSlotResultSchema,
  NO_TOOL_RETRY,
  ok,
  RationalTime,
  type AnyTool,
  type AsyncResult,
  type Template,
  type Timeline,
  type TimelineItemId,
  type ToolContextBase,
} from '@taalcut/core';
import type { z } from 'zod';
import { InvalidMove } from '../errors';
import { positions, videoItems } from '../model/sequence';
import { heardAt, reelTimeAt, repeatsOf } from '../music/carry';
import type { TimelineService } from '../service/service';
import type { TemplateReader } from '../service/templates';
import { oneClipId, type ClipNumbering } from './clip-refs';
import { toolKey } from './hash';
import { clipLengths, heardBars, planLengthen, type LengthenPlan } from './length-facts';
import {
  lengthenSlotInputSchema,
  lengthenSlotOutputSchema,
  musicBarsInputSchema,
  musicBarsOutputSchema,
  type lengthenStatementSchema,
} from './lengthen-schemas';
import type { ReelMusic, ReelMusicDeps } from './reel-music';
import type { ShotDescriptions } from './rerank-material';

export interface LengthenToolDeps extends ReelMusicDeps {
  readonly service: Pick<TimelineService, 'read'>;
  readonly templates: Pick<TemplateReader, 'read'>;
  readonly numbering?: ClipNumbering;
  readonly shotDescriptions?: ShotDescriptions;
}

/** Said with timeline.musicBars' answer: how its numbers are read, and what stating a lengthening takes. */
export const BARS_WORDS =
  'Times are seconds of the video. `music.bars` are the bar lines (`again`: a bar played a second time); `sure` ' +
  'is 0 to 1 for each part of the measurement; `changes` are where the sound changes most. A clip’s `shot.before` ' +
  'and `shot.after` are the seconds of its shot not shown, before and after what it plays; `lands` is the instant ' +
  'of the shot on its slot’s cut now. To lengthen, state the clip, whole bars, a bar line inside the clip (its ' +
  'end counts) and which footage is added; `would` answers what that does before timeline.lengthenSlot does it.';

const s2 = (seconds: number) => Math.round(seconds * 100) / 100;
const s3 = (seconds: number) => Math.round(seconds * 1000) / 1000;

async function templateOf(timeline: Timeline, deps: LengthenToolDeps): Promise<Template | null> {
  if (!timeline.template) return null;
  const found = await deps.templates.read(timeline.template);
  return found.ok ? found.value : null;
}

/** Why the reel's bars can't be counted under this video, or null when they can. */
function unmeasurable(timeline: Timeline): string | null {
  if (timeline.music.path !== 'referenceAudio')
    return `The video’s music is not the reel’s own (music: ${timeline.music.path}): bars are measured for the reel’s music only.`;
  const shift = timeline.mix.music?.shift;
  if (shift && shift.value !== 0)
    return `The music was moved ${s2(RationalTime.toSeconds(shift))} s against the picture (audio.move): bars are counted on the reel’s own time.`;
  return null;
}

async function musicOf(
  timeline: Timeline,
  deps: LengthenToolDeps,
  signal: AbortSignal | undefined,
): AsyncResult<ReelMusic | null> {
  if (!deps.reelMusic || !timeline.template) return ok(null);
  return deps.reelMusic(timeline.template.id, signal);
}

type Statement = z.output<typeof lengthenStatementSchema>;

async function planned(
  timeline: Timeline,
  template: Template | null,
  music: ReelMusic | null,
  statement: Statement & { readonly revision?: number | undefined },
  ctx: ToolContextBase,
  deps: LengthenToolDeps,
): AsyncResult<LengthenPlan> {
  const clipId = await oneClipId(
    { clip: statement.clip },
    {
      timeline,
      editor: ctx.editor,
      revision: statement.revision,
      describe: deps.shotDescriptions,
      numbering: deps.numbering,
      runId: ctx.runId,
    },
  );
  if (!clipId.ok) return clipId;
  return ok(
    planLengthen(timeline, template, music, {
      clipId: clipId.value as TimelineItemId,
      bars: statement.bars,
      at: statement.at,
      footage: statement.footage,
    }),
  );
}

export function lengthenTools(deps: LengthenToolDeps): AnyTool[] {
  const read = defineTool({
    name: 'timeline.musicBars',
    // FIX-ROUTE (1.0.1, with timeline.lengthenSlot): the tag "run", so "let my part run longer" loads them.
    version: '1.0.1',
    description:
      'Reads the facts for making a video longer. The reel’s music, measured from its sound: the bar’s length, ' +
      'each bar line in seconds of the video, how sure the measurement is, where the music changes strongly. ' +
      'Each clip: its place and length, and how much of its shot lies before and after what it plays. With ' +
      '`would` it answers what a lengthening would do (new length, what moves, where the instant on the cut ' +
      'lands) or why it can’t be done, changing nothing.',
    summary: "Reads the music's bars under a video and each clip's spare footage, for making it longer.",
    tags: ['music', 'bars', 'beat', 'longer', 'lengthen', 'extend', 'length', 'duration', 'repeat', 'run'],
    input: musicBarsInputSchema,
    output: musicBarsOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 60_000,
    retry: NO_TOOL_RETRY,
    idempotencyKey: (input) => toolKey('timeline.musicBars', input),
    permission: { filesystem: { read: ['library'] } },
    run: async (input, ctx) => {
      const found = await deps.service.read(input.timelineId);
      if (!found.ok) return found;
      const timeline = found.value;
      const template = await templateOf(timeline, deps);
      const music = await musicOf(timeline, deps, ctx.signal);
      if (!music.ok) return music;
      const rate = timeline.canvas.rate;
      const fps = FrameRate.toNumber(rate);
      const frames = positions(videoItems(timeline)).at(-1)?.end ?? 0;
      const why =
        unmeasurable(timeline) ??
        (music.value
          ? music.value.bars.steady
            ? null
            : `No steady bars were found in the reel’s music. ${music.value.bars.why ?? ''}`.trim()
          : 'This video’s template keeps no reel with sound on this Mac, so there is no music to measure.');
      const bars = music.value?.bars;
      const repeats = repeatsOf(timeline);
      const slotNumber = (slotId: string | null) => {
        const index = template?.slots.findIndex((slot) => slot.id === slotId) ?? -1;
        return index >= 0 ? index + 1 : null;
      };
      let plan: LengthenPlan | null = null;
      if (input.would) {
        const tried = await planned(timeline, template, music.value, input.would, ctx, deps);
        if (!tried.ok) return tried;
        plan = tried.value;
      }
      const heard = bars && !why ? heardBars(timeline, bars) : [];
      return ok({
        timelineId: timeline.id,
        revision: timeline.revision,
        video: { frames, seconds: s2(frames / fps), framesPerSecond: s3(fps) },
        music: {
          path: timeline.music.path,
          measured: why === null,
          ...(why ? { why } : {}),
          ...(bars
            ? {
                reelSeconds: s2(bars.seconds),
                bpm: bars.bpm,
                beatsPerBar: bars.beatsPerBar,
                barSeconds: bars.barSeconds === null ? null : s3(bars.barSeconds),
                barFrames: bars.barSeconds === null ? null : s2(bars.barSeconds * fps),
                sure: bars.sure,
                measuredAcrossBeats: bars.measuredAcrossBeats,
              }
            : {}),
          bars: heard,
          changes:
            bars && !why
              ? bars.changes
                  .flatMap((change) =>
                    heardAt(repeats, change.at).map((at) => ({
                      at: s3(at),
                      levelDb: change.levelDb,
                      bandsDb: change.bandsDb,
                    })),
                  )
                  .sort((a, b) => a.at - b.at)
              : [],
          repeats: repeats.map((repeat) => {
            const at = RationalTime.toSeconds(repeat.at);
            return {
              at: s3(at),
              backTo: s3(reelTimeAt(repeats, at)),
              frames: repeat.length.value,
              bars: repeat.bars,
              slot: slotNumber(repeat.slotId),
            };
          }),
        },
        clips: clipLengths(timeline, template),
        reading: BARS_WORDS,
        ...(plan?.ok ? { would: plan.would } : {}),
        ...(plan && !plan.ok ? { cannot: plan.why } : {}),
      });
    },
  });

  const write = defineTool({
    name: LENGTHEN_SLOT_COMMAND,
    version: '1.0.1',
    description:
      'Makes one of the person’s clips longer by whole bars of the reel’s music. At `at`, a bar line inside the ' +
      'clip (its end counts), the music plays the bars before it again, joined by a 50 ms crossfade; the clip ' +
      'shows that much more of its shot (`footage`); every later clip, transition, text and caption is later by ' +
      'the same whole frames, so the reel’s own clips stay on their music. Applied exactly as stated, or not at ' +
      'all with why in numbers. Read timeline.musicBars first. One undo step.',
    summary:
      'Makes a clip longer by whole bars of the music, which plays those bars again; the rest moves later.',
    tags: ['longer', 'lengthen', 'extend', 'length', 'duration', 'music', 'bars', 'repeat', 'loop', 'run'],
    input: lengthenSlotInputSchema,
    output: lengthenSlotOutputSchema,
    costClass: 'local',
    sideEffect: 'write',
    command: LENGTHEN_SLOT_COMMAND,
    timeoutMs: 60_000,
    retry: NO_TOOL_RETRY,
    idempotencyKey: (input) => toolKey(LENGTHEN_SLOT_COMMAND, input),
    permission: { filesystem: { read: ['library'] } },
    run: async (input, ctx) => {
      const found = await deps.service.read(input.timelineId);
      if (!found.ok) return found;
      const timeline = found.value;
      const template = await templateOf(timeline, deps);
      const music = await musicOf(timeline, deps, ctx.signal);
      if (!music.ok) return music;
      const tried = await planned(timeline, template, music.value, input, ctx, deps);
      if (!tried.ok) return tried;
      const plan = tried.value;
      if (!plan.ok) return err(InvalidMove(undefined, { detail: plan.why }));
      const done = await ctx.dispatch({
        projectId: input.projectId,
        timelineId: input.timelineId,
        revision: timeline.revision,
        clipId: plan.input.clipId,
        frames: plan.input.frames,
        bars: plan.input.bars,
        at: plan.input.at,
        crossfade: plan.input.crossfade,
        footage: plan.input.footage,
      });
      if (!done.ok) return done;
      const receipt = lengthenSlotResultSchema.parse(done.value);
      return ok({
        timelineId: receipt.timelineId,
        revision: receipt.revision,
        affectedItemIds: receipt.affectedItemIds,
        ...plan.would,
      });
    },
  });

  return [read as AnyTool, write as AnyTool];
}
