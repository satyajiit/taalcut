// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- the made-up chat's words: data, never translated */

/**
 * HFW1-UI: with the fake's `media: { designs: true }`, Golden hour market's first video gets graphics the AI
 * "designed" (the ui kit's design fixtures) in place of the kit's: an incoming question and a reply drawn with the
 * chat bubble (version 1, used) and a price tag the chat proposed; the project's workspace holds the revisions
 * their files came from. Pure but for the seed: the document in, the arranged document out.
 */
import { RationalTime, timelineSchema, type GraphicItem, type Timeline } from '@taalcut/core';
import { DESIGN_COMPOSITIONS, DESIGN_FIXTURE_IDS, designRevisions, MEDIA_FIXTURE_IDS } from '@taalcut/ui';
import type { FakeWorkspace } from './fake-workspace';

const ids = DESIGN_FIXTURE_IDS.graphics;

function designed(
  id: GraphicItem['id'],
  composition: (typeof DESIGN_COMPOSITIONS)[keyof typeof DESIGN_COMPOSITIONS],
  frames: { start: number; length: number },
  rate: Timeline['canvas']['rate'],
  rest: Partial<GraphicItem> & Pick<GraphicItem, 'placement'>,
  params: Record<string, string | boolean>,
): GraphicItem {
  const start = RationalTime.of(frames.start, rate);
  return {
    type: 'graphic',
    id,
    anchor: { kind: 'time', at: start },
    start,
    duration: RationalTime.of(frames.length, rate),
    styleKey: 'composition',
    language: null,
    origin: 'agent',
    composition: { id: composition.id, hash: composition.hash, params },
    ...rest,
  };
}

/** Golden hour's first video with its designed graphics; the document as it was if it isn't that video. */
export function arrangeDesigns(timeline: Timeline): Timeline {
  if (timeline.id !== MEDIA_FIXTURE_IDS.timelines[0] || timeline.projectId !== MEDIA_FIXTURE_IDS.project)
    return timeline;
  const rate = timeline.canvas.rate;
  const { bubble, priceTag } = DESIGN_COMPOSITIONS;
  const items = [
    designed(
      ids.askBubble,
      bubble,
      { start: 30, length: 75 },
      rate,
      { placement: 'top' },
      {
        message: 'Are you at the market?',
        side: 'left',
      },
    ),
    designed(
      ids.replyBubble,
      bubble,
      { start: 105, length: 60 },
      rate,
      { placement: 'top' },
      {
        message: 'Almost there',
        side: 'right',
        ticks: true,
      },
    ),
    designed(
      ids.priceTag,
      priceTag,
      { start: 180, length: 75 },
      rate,
      {
        placement: 'bottom',
        proposal: { request: 'put the mango price on screen', design: 'designed', createdAt: 0 },
      },
      { item: 'Mangoes', price: '₹120 a dozen' },
    ),
  ];
  const next: Timeline = {
    ...timeline,
    tracks: [
      ...timeline.tracks.filter((track) => track.id !== 'T2'),
      { kind: 'text', id: 'T2', name: 'Graphics', enabled: true, items },
    ],
    graphicCompositions: [bubble, priceTag],
  };
  const checked = timelineSchema.safeParse(next);
  return checked.success ? checked.data : timeline;
}

/** Puts the designs on the fake's Golden hour video and seeds its project's workspace. */
export function seedDesigns(
  timelines: { all(): readonly Timeline[]; replace(projectId: Timeline['projectId'], next: Timeline): void },
  workspace: FakeWorkspace,
): void {
  for (const timeline of timelines.all()) {
    const arranged = arrangeDesigns(timeline);
    if (arranged !== timeline) timelines.replace(timeline.projectId, arranged);
  }
  workspace.seed(MEDIA_FIXTURE_IDS.project, designRevisions(MEDIA_FIXTURE_IDS.project));
}
