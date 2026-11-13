// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Pro export, gaps, cleanup, variants, energy curves, batch looks: their schemas, commands and reads (P3). */
import { describe, expect, it } from 'vitest';
import {
  BATCH_COMMANDS,
  batchCommandPayloads,
  CAPTION_PRESET_IDS,
  CAPTION_PRESETS,
  captionStyleSchema,
  CLEANUP_SETTING,
  cleanupPlanSchema,
  cleanupSettingsSchema,
  energyCurveSchema,
  energySlotMapSchema,
  HOOK_WINDOW_SECONDS,
  interchangeExportResultSchema,
  interchangeFormatSchema,
  interchangeWarningSchema,
  newId,
  ok,
  TIMELINE_COMMANDS,
  timelineCommandPayloads,
  timelinesContract,
  timelinesRouter,
  variantDifferenceSchema,
  variantsShortSchema,
  type CleanupPlan,
  type EnergyCurve,
  type GapView,
  type TimelinesService,
} from '@taalcut/core';
import { at, captionTrack, ntscTimeline, span } from './helpers/documents';
import { serve } from './helpers/phase3';

const projectId = newId<'Project'>();
const timelineId = newId<'Timeline'>();
const clipId = newId<'TimelineItem'>();
const slotId = newId<'TemplateSlot'>();
const target = { projectId, timelineId };
const candidate = {
  assetId: newId<'Asset'>(),
  shotId: null,
  sourceStart: at(0),
  syncPoint: null,
  score: 0.8,
  parts: { intent: 1, motion: 1, quality: 1, subject: 1, energy: 1, hook: null, rerank: null, penalty: 0 },
};
const plan: CleanupPlan = {
  timelineId,
  revision: 3,
  clips: [
    {
      clipId,
      keep: [span(0, 40), span(50, 40)],
      newIds: [newId<'TimelineItem'>()],
      punch: [{ range: span(60, 20), reframe: { mode: 'subject', nudge: { x: 0, y: 0 }, scale: 1.1 } }],
    },
  ],
  stats: { fillers: 2, pauses: 1, retakes: 0, punchIns: 1, secondsSaved: 0.7 },
};
const curve: EnergyCurve = {
  sections: [{ fromSlotId: slotId, toSlotId: slotId, energy: 0.9, beatsPerClip: 1, align: 'downbeat' }],
};

describe('cleanup', () => {
  it('defaults to every pass with a 10% punch-in', () => {
    expect(CLEANUP_SETTING.key).toBe('cleanup.defaults');
    expect(cleanupSettingsSchema.parse(CLEANUP_SETTING.defaultValue)).toMatchObject({ punchScale: 1.1 });
    expect(cleanupSettingsSchema.safeParse({ ...CLEANUP_SETTING.defaultValue, punchScale: 2 }).success).toBe(
      false,
    );
  });

  it('a plan keeps ranges and punches in with a reframe', () => {
    expect(cleanupPlanSchema.safeParse(plan).success).toBe(true);
    const [clip] = plan.clips;
    expect(cleanupPlanSchema.safeParse({ ...plan, clips: [{ ...clip, keep: [] }] }).success).toBe(false);
    expect(cleanupPlanSchema.safeParse({ ...plan, revision: 0 }).success).toBe(false);
  });
});

describe('variants', () => {
  it('say what differs from the base, and why fewer were made', () => {
    const difference = {
      timelineId,
      hookChanged: true,
      picksChanged: 0.4,
      music: { path: 'platformSound' },
      captionPreset: 'bold',
    };
    expect(variantDifferenceSchema.safeParse(difference).success).toBe(true);
    expect(variantDifferenceSchema.safeParse({ ...difference, captionPreset: 'neon' }).success).toBe(false);
    expect(variantsShortSchema.safeParse({ axis: 'hook', asked: 3, made: 1 }).success).toBe(true);
    expect(HOOK_WINDOW_SECONDS).toBe(3);
  });

  it('caption presets are valid caption styles', () => {
    for (const id of CAPTION_PRESET_IDS)
      expect(captionStyleSchema.safeParse(CAPTION_PRESETS[id]).success, id).toBe(true);
  });
});

describe('pro export', () => {
  it('describes formats, results and warnings', () => {
    const otio = { id: 'otio', version: '0.17', fileExtension: '.otio', labelKey: 'interchange.otio' };
    expect(interchangeFormatSchema.safeParse(otio).success).toBe(true);
    expect(interchangeFormatSchema.safeParse({ ...otio, fileExtension: 'otio' }).success).toBe(false);
    const warnings = [
      { code: 'mediaOffline', clipId },
      { code: 'rampApproximated', clipId },
      { code: 'transitionAsCut', itemId: clipId },
      { code: 'textAsMarker', count: 2 },
      { code: 'imageAsStill', clipId },
    ];
    for (const warning of warnings) expect(interchangeWarningSchema.safeParse(warning).success).toBe(true);
    expect(interchangeExportResultSchema.safeParse({ fileName: 'Goa.fcpxml', warnings }).success).toBe(true);
    expect(interchangeWarningSchema.safeParse({ code: 'textAsMarker', count: 0 }).success).toBe(false);
  });
});

describe('timeline commands (P3)', () => {
  const p = timelineCommandPayloads;

  it('export, fill a gap, drop a slot', () => {
    expect(p[TIMELINE_COMMANDS.exportInterchange].parse({ ...target, format: 'fcpxml' })).toMatchObject({
      pathStyle: 'fileUrl',
    });
    expect(p[TIMELINE_COMMANDS.exportInterchange].safeParse({ ...target, format: 'aaf' }).success).toBe(
      false,
    );
    const fill = p[TIMELINE_COMMANDS.fillGap];
    expect(
      fill.parse({ ...target, gapId: clipId, media: { kind: 'image', assetId: candidate.assetId } }),
    ).toMatchObject({
      media: { stillMotion: 'pushIn' },
    });
    expect(
      fill.safeParse({
        ...target,
        gapId: clipId,
        media: { kind: 'video', assetId: candidate.assetId, shotId: null },
      }).success,
    ).toBe(true);
    expect(p[TIMELINE_COMMANDS.dropSlot].parse({ ...target, itemId: clipId })).toMatchObject({
      mode: 'ripple',
    });
    expect(p[TIMELINE_COMMANDS.dropSlot].safeParse({ ...target, itemId: clipId, mode: 'keep' }).success).toBe(
      false,
    );
  });

  it('cleanup, energy curve, look, reframe and filming', () => {
    expect(p[TIMELINE_COMMANDS.applyCleanup].safeParse({ ...target, plan }).success).toBe(true);
    const energy = { ...target, templateBaseVersion: 2, curve, picks: [{ slotId, pick: candidate }] };
    expect(p[TIMELINE_COMMANDS.applyEnergyCurve].safeParse(energy).success).toBe(true);
    expect(p[TIMELINE_COMMANDS.setStyle].safeParse({ ...target, styleId: newId<'Style'>() }).success).toBe(
      true,
    );
    const reframe = { mode: 'centre', nudge: { x: 0, y: 0.2 }, scale: 1 };
    expect(p[TIMELINE_COMMANDS.setReframe].safeParse({ ...target, clipId, reframe }).success).toBe(true);
    expect(
      p[TIMELINE_COMMANDS.setReframe].safeParse({ ...target, clipId, reframe: null, revision: 4 }).success,
    ).toBe(true);
    expect(
      p[TIMELINE_COMMANDS.markForFilming].safeParse({ ...target, slotIds: [slotId], on: true }).success,
    ).toBe(true);
    expect(p[TIMELINE_COMMANDS.markForFilming].safeParse({ ...target, slotIds: [], on: true }).success).toBe(
      false,
    );
  });

  it('restore puts the look, voiceover, mix and template back', () => {
    const timeline = ntscTimeline();
    const restore = p[TIMELINE_COMMANDS.restore];
    const parts = {
      ...target,
      styleId: null,
      voiceover: null,
      mix: timeline.mix,
      template: timeline.template,
      templateHead: { templateId: newId<'Template'>(), version: 1, expectedHead: 2 },
    };
    expect(restore.safeParse(parts).success).toBe(true);
  });

  it('batch looks apply to up to 50 timelines and restore what they changed', () => {
    const items = [{ projectId, timelineId }];
    const apply = batchCommandPayloads[BATCH_COMMANDS.applyStyle];
    expect(apply.safeParse({ items, apply: { kind: 'style', styleId: newId<'Style'>() } }).success).toBe(
      true,
    );
    expect(apply.safeParse({ items, apply: { kind: 'captionPreset', presetId: 'karaoke' } }).success).toBe(
      true,
    );
    expect(
      apply.safeParse({ items: [], apply: { kind: 'captionPreset', presetId: 'karaoke' } }).success,
    ).toBe(false);
    const restore = batchCommandPayloads[BATCH_COMMANDS.restoreStyles];
    const captions = captionTrack([[0, 30]]);
    expect(
      restore.safeParse({ items: [{ ...items[0], styleId: null, captions, revision: 2 }] }).success,
    ).toBe(true);
  });
});

describe('energy curves', () => {
  it('sections pick a pace on the beat grid, and the slot map says where each slot came from', () => {
    expect(energyCurveSchema.safeParse(curve).success).toBe(true);
    const off = { sections: [{ ...curve.sections[0], beatsPerClip: 5 }] };
    expect(energyCurveSchema.safeParse(off).success).toBe(false);
    expect(energyCurveSchema.safeParse({ sections: [] }).success).toBe(false);
    expect(energySlotMapSchema.safeParse([{ slotId, from: [slotId], unchanged: true }]).success).toBe(true);
    expect(energySlotMapSchema.safeParse([{ slotId, from: [], unchanged: true }]).success).toBe(false);
  });
});

describe('timelines namespace (P3 reads)', () => {
  const base: TimelinesService = {
    listByProject: async () => ok([]),
    get: async () => ok(ntscTimeline()),
    async *watch() {
      yield ntscTimeline();
    },
    findAlternates: async () => ok([]),
  };

  it('answers core.not_implemented until @taalcut/timeline has them', async () => {
    const client = serve(timelinesContract, timelinesRouter(base));
    for (const call of [
      () => client.interchangeFormats(),
      () => client.gaps({ timelineId }),
      () => client.shotList({ timelineId }),
      () => client.planCleanup({ timelineId }),
      () => client.planEnergyCurve({ timelineId, curve }),
    ])
      await expect(call()).rejects.toMatchObject({ data: { code: 'core.not_implemented' } });
  });

  it('serves them when it does', async () => {
    const asked: unknown[] = [];
    const gap: GapView = {
      gapId: clipId,
      slotId,
      number: 4,
      start: at(90),
      duration: at(30),
      intent: { text: 'A wide of the beach', shotType: 'wide', motion: 'static', energy: 0.4 },
      note: null,
    };
    const shot = {
      slotId,
      number: 4,
      what: 'A wide of the beach',
      shotType: 'wide',
      motion: 'static',
      seconds: 1,
      orientation: 'portrait',
    } as const;
    const client = serve(
      timelinesContract,
      timelinesRouter({
        ...base,
        interchangeFormats: async () =>
          ok([{ id: 'otio', version: '0.17', fileExtension: '.otio', labelKey: 'interchange.otio' }]),
        gaps: async () => ok([gap]),
        shotList: async () => ok([shot]),
        planCleanup: async (id, settings) => (asked.push([id, settings]), ok(plan)),
        planEnergyCurve: async () =>
          ok({ templateBaseVersion: 2, slotMap: [], changedSlots: 0, picks: [], cuts: [0, 30] }),
      }),
    );
    expect(await client.interchangeFormats()).toHaveLength(1);
    expect((await client.gaps({ timelineId }))[0]?.number).toBe(4);
    expect((await client.shotList({ timelineId }))[0]?.orientation).toBe('portrait');
    expect((await client.planCleanup({ timelineId, settings: { punchIns: false } })).stats.fillers).toBe(2);
    expect((await client.planEnergyCurve({ timelineId, curve })).cuts).toEqual([0, 30]);
    expect(asked).toEqual([[timelineId, { punchIns: false }]]);
  });
});
