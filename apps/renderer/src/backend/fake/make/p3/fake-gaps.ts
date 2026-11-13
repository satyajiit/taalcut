// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B8: a timeline's gaps and the phone's shot list (timelines.gaps, timelines.shotList), and the commands that fill, drop or mark them (timeline.fillGap, timeline.dropSlot, timeline.markForFilming).
 *
 * Each command edits through the Make fakes' timelines (one revision, announced, undone by timeline.restore) and
 * refuses as packages/timeline does: a missing timeline, a gap that isn't there or isn't a gap, media too short
 * for the gap or not in the library, a locked clip for the agent, an empty video, an unknown slot. `punch` turns
 * clips into gaps (the fixture e2e and the dev build use; `gaps: { punch: 'golden' }` in taalcut.fake does it at
 * start on Golden hour market's second video, slots 3 and 7).
 */
import {
  appContract,
  defineCommand,
  implementContract,
  TIMELINE_COMMANDS,
  timelineCommandPayloads,
  toRpcError,
  type AnyCommand,
  type ProjectId,
  type Template,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import { stockMediaOf } from '../../phase3/stock/stock-data';
import { readGapsArea } from './gaps/gaps-area';
import { timelineError } from '../edits';
import { GOLDEN_PROJECT, GOLDEN_TIMELINES } from '../ids';
import type { MakeP3Deps } from './deps';
import { dropSlot } from './gaps/drop-slot';
import { fillGap, gapRefusal, markForFilming, punch, type GapFill } from './gaps/gap-edits';
import { gapsOf, shotListOf } from './gaps/gap-reads';

const PROCEDURES = { gaps: appContract.timelines.gaps, shotList: appContract.timelines.shotList };
const P = timelineCommandPayloads;
type FillMedia = ReturnType<(typeof P)[typeof TIMELINE_COMMANDS.fillGap]['parse']>['media'];

/** The dev build's and screenshots' gaps: Golden hour market, video 2, slots 3 and 7. */
const GOLDEN_GAPS = { projectId: GOLDEN_PROJECT, timelineId: GOLDEN_TIMELINES[1], slots: [3, 7] } as const;

export function createFakeGaps(deps: MakeP3Deps) {
  const area = readGapsArea(deps.options.areas?.['gaps']);
  const templateOf = (timeline: Timeline): Template | null =>
    timeline.template ? deps.templates.template(timeline.template.id, timeline.template.version) : null;
  const read = (timelineId: TimelineId) => {
    const timeline = deps.timelines.get(timelineId);
    if (!timeline) throw toRpcError(timelineError('timeline.not_found', { timelineId }));
    return timeline;
  };

  /** What fills the gap: a still as asked, or a video the library (or an imported stock video) has. */
  function resolveFill(media: FillMedia): GapFill | null {
    if (media.kind === 'image')
      return { kind: 'image', assetId: media.assetId, stillMotion: media.stillMotion };
    const shot = deps.shots.get(media.shotId ?? media.assetId);
    const stock = shot ? undefined : stockMediaOf(media.assetId);
    const available = shot?.available ?? stock?.available;
    if (!available) return null;
    return {
      kind: 'video',
      assetId: media.assetId,
      shotId: shot ? media.shotId : null,
      available,
      ...(media.sourceStart ? { sourceStart: media.sourceStart } : {}),
    };
  }

  const os = implementContract(PROCEDURES);
  const router = {
    gaps: os.gaps.handler(({ input }) => {
      const timeline = read(input.timelineId);
      return gapsOf(timeline, templateOf(timeline));
    }),
    shotList: os.shotList.handler(({ input }) => {
      const timeline = read(input.timelineId);
      return shotListOf(timeline, templateOf(timeline));
    }),
  };

  const base = { sideEffect: 'write' as const, project: (p: { projectId: ProjectId }) => p.projectId };
  const commands: AnyCommand[] = [
    defineCommand({
      ...base,
      name: TIMELINE_COMMANDS.fillGap,
      payload: P[TIMELINE_COMMANDS.fillGap],
      handle: async (p) =>
        deps.timelines.edit(p, (timeline) => {
          // The gap first (gap_not_found, not_a_gap), then the media, as the real handler resolves them.
          const refused = gapRefusal(timeline, p.gapId);
          if (refused) return { ok: false, error: refused };
          const fill = resolveFill(p.media);
          if (!fill)
            return {
              ok: false,
              error: timelineError('timeline.media_missing', { assetId: p.media.assetId }),
            };
          return fillGap(timeline, p.gapId, fill);
        }),
    }),
    defineCommand({
      ...base,
      name: TIMELINE_COMMANDS.dropSlot,
      payload: P[TIMELINE_COMMANDS.dropSlot],
      handle: async (p, context) =>
        deps.timelines.edit(p, (timeline) => dropSlot(timeline, p, context.source)),
    }),
    defineCommand({
      ...base,
      name: TIMELINE_COMMANDS.markForFilming,
      payload: P[TIMELINE_COMMANDS.markForFilming],
      handle: async (p) => deps.timelines.edit(p, (timeline) => markForFilming(timeline, p.slotIds, p.on)),
    }),
  ];

  /** Turns the clips at these places on V1 into gaps (a new revision, announced); false when there's no such timeline. */
  function punchTimeline(projectId: ProjectId, timelineId: TimelineId, slots: readonly number[]): boolean {
    const timeline = deps.timelines.get(timelineId);
    if (!timeline) return false;
    deps.timelines.replace(projectId, punch(timeline, slots));
    return true;
  }
  if (area.punch === 'golden' && GOLDEN_GAPS.timelineId)
    punchTimeline(GOLDEN_GAPS.projectId, GOLDEN_GAPS.timelineId, GOLDEN_GAPS.slots);

  return {
    router,
    commands,
    punch: punchTimeline,
    /** The stock service's scenario from the same options, for the stock fake (phase3/fake-stock.ts). */
    stockScenario: area.stock,
  };
}
