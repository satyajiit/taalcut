// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: video.done and the Maker's done-gate hold a video whose text would be drawn in the default face, with
 * the Style the video renders with read through render's own resolution, and one whose text from the reference has
 * no stated place; with a look for every role and a place for every text they pass. Neither judges a place: what QA
 * measured of the text (a head under it, the platform's interface over it) is a note, and no reason is asked for it.
 */
import { describe, expect, it } from 'vitest';
import {
  err,
  newId,
  NotImplementedError,
  ok,
  styleSchema,
  type ArtifactId,
  type CommandToolContext,
  type QaCheckResult,
  type Style,
  type TextItem,
  type TextLook,
  type Timeline,
} from '@taalcut/core';
import { makerDone, videoToolModule, type VideoDoneDeps } from '../../src/tools/video-done-tool';
import { checkResult } from '../../src/qa/result';
import { memoryTimelines, renderRow } from '../commands/support';
import { report } from '../qa/support';
import { memoryRenderStore } from '../support/render-store';
import { makeTimeline } from '../support/timeline';

const LOOK: TextLook = {
  font: { family: 'montserrat', weight: 800 },
  colour: '#ffffff',
  background: null,
  stroke: { colour: '#000000', widthPx: 5 },
  shadow: null,
};

const styleWith = (textStyles: Style['textStyles']): Style =>
  styleSchema.parse({
    schemaVersion: 1,
    id: newId<'Style'>(),
    revision: 1,
    name: 'Heavy white',
    kind: 'look',
    colours: {
      primary: '#ffffff',
      secondary: '#000000',
      accent: '#ffffff',
      text: '#ffffff',
      background: '#000000',
    },
    fonts: { heading: LOOK.font, body: LOOK.font },
    captions: null,
    textStyles,
    logo: null,
    watermark: null,
    intro: null,
    outro: null,
    grade: null,
    fontMatch: null,
    madeFrom: null,
    createdAt: 0,
    updatedAt: 0,
  });

/** The timeline's texts as made from a reference's overlay, placed by `placedBy` or by nobody yet. */
const fromReference =
  (placedBy?: TextItem['placedBy']) =>
  (timeline: Timeline): Timeline => ({
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.kind !== 'text'
        ? track
        : {
            ...track,
            items: track.items.map((item) =>
              item.type !== 'text'
                ? item
                : { ...item, overlayId: newId<'TextOverlay'>(), ...(placedBy ? { placedBy } : {}) },
            ),
          },
    ),
  });

function setup(
  style: Style | null | undefined,
  texts = [{ start: 0, frames: 30, text: 'Hello' }],
  made: (timeline: Timeline) => Timeline = (timeline) => timeline,
  checks: readonly QaCheckResult[] = [],
) {
  // makeTimeline's text has the role (styleKey) 'title', and is one added by hand (no overlay).
  const timeline = made(makeTimeline({ items: [{ frames: 60 }], texts }));
  const store = memoryRenderStore();
  const draft = renderRow({
    projectId: timeline.projectId,
    timelineId: timeline.id,
    timelineRevision: timeline.revision,
    status: 'ready',
    createdAt: 5,
    qaReport: report(checks),
  });
  store.records.set(draft.id, draft);
  const deps: VideoDoneDeps = {
    store,
    timelines: memoryTimelines(timeline),
    ...(style === undefined ? {} : { styles: { styleFor: async () => ok(style) } }),
  };
  const tool = videoToolModule(deps).tools[0]!;
  const ctx = {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    runId: newId<'AgentRun'>(),
    attempt: 1,
    artifacts: {
      put: async () =>
        ok({ id: newId<'Artifact'>() as ArtifactId, mediaType: 'application/json', bytes: 1, summary: '' }),
      get: async () => err(NotImplementedError()),
    },
    reportUsage: () => undefined,
    reportProgress: () => undefined,
    dispatch: async () => err(NotImplementedError()),
  } as CommandToolContext;
  const run = () => tool.run({ projectId: timeline.projectId, timelineId: timeline.id } as never, ctx);
  const gate = () => makerDone(deps)({ timelineId: timeline.id, revision: timeline.revision });
  return { run, gate, draft };
}

describe('video.done and text in the default face (TXT1)', () => {
  it('refuses a video with no Style, naming the role and the tools that design it', async () => {
    const { run, gate } = setup(null);
    const refused = await run();
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.detail).toBe(
      'The video\'s on-screen text has no designed look and would be drawn in the default face: "title" ' +
        '(1 text). Read timeline.textLook (the roles, the reference’s measured look, the faces), then give every ' +
        'role a look with timeline.designText, starting from the reference’s unless the person asked for another. ' +
        'Then render.draft again and call video.done.',
    );
    const handoff = await gate();
    expect(handoff.ok && handoff.value.passed).toBe(false);
  });

  it('refuses a Style that has no look for the role, and passes once it has', async () => {
    expect((await setup(styleWith({ label: LOOK })).run()).ok).toBe(false);
    const designed = setup(styleWith({ title: LOOK }));
    const passed = await designed.run();
    expect(passed.ok).toBe(true);
    if (passed.ok) expect(passed.value).toMatchObject({ renderId: designed.draft.id });
    const handoff = await designed.gate();
    expect(handoff.ok && handoff.value.passed).toBe(true);
  });

  it('holds nothing where the process has no style store', async () => {
    expect((await setup(undefined).run()).ok).toBe(true);
  });

  it('holds a text from the reference nobody has placed, in words that name the tool; passes once placed', async () => {
    const style = styleWith({ title: LOOK });
    const unplaced = setup(style, undefined, fromReference());
    const refused = await unplaced.run();
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.detail).toBe(
      "1 of the video's on-screen texts has no stated place or size yet: it sits where the reference had it. " +
        'Read timeline.textLook (each group, what is under it here), look at the text in your draft frames, then ' +
        'state every group’s place and size with timeline.placeText (asReel: true keeps the reference’s). Then ' +
        'render.draft again and call video.done.',
    );
    const handoff = await unplaced.gate();
    expect(handoff.ok && handoff.value.passed).toBe(false);
    // Placed by the AI, or by the person: both are a stated place, and where it is is never judged.
    for (const placedBy of ['editor', 'person'] as const) {
      const placed = setup(style, undefined, fromReference(placedBy));
      expect((await placed.run()).ok).toBe(true);
      const passed = await placed.gate();
      expect(passed.ok && passed.value.passed).toBe(true);
    }
    // No style store in the process: not held.
    expect((await setup(undefined, undefined, fromReference()).run()).ok).toBe(true);
  });

  it('asks no reason for what QA noted about the text: a head under it, the platform’s interface over it', async () => {
    const title = { kind: 'text' as const, id: 'title' };
    const notes = [
      checkResult('graphicCoversFace', 'warn', { findings: [{ target: title }] }, 0),
      checkResult('captionSafeZone', 'warn', { findings: [{ target: title }] }, 0),
    ];
    const noted = setup(styleWith({ title: LOOK }), undefined, fromReference('editor'), notes);
    const passed = await noted.run();
    expect(passed.ok).toBe(true);
    const handoff = await noted.gate();
    expect(handoff.ok && handoff.value.passed).toBe(true);
    // A graphic over a head is still a failure it holds.
    const failing = [checkResult('graphicCoversFace', 'fail', { findings: [{ target: title }] }, 0)];
    const held = setup(styleWith({ title: LOOK }), undefined, fromReference('editor'), failing);
    const refused = await held.run();
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.detail).toContain('graphicCoversFace');
  });

  it('never holds a video with no text at all, whatever Style it has or lacks', async () => {
    for (const style of [null, styleWith({}), styleWith({ title: LOOK })]) {
      const world = setup(style, []);
      expect((await world.run()).ok).toBe(true);
      const handoff = await world.gate();
      expect(handoff.ok && handoff.value.passed).toBe(true);
    }
  });
});
