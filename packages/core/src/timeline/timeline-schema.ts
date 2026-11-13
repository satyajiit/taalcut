// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Timeline v2 (P2-M1, P3): an OTIO-shaped edit of one variant. The renderer's
 * editor and cards, the library's store and snapshots, and render all read
 * it, and the first two may import only core. Edits are TIMELINE_COMMANDS;
 * captions (render's caption track), the music choice, the look, the
 * voiceover and the mix are part of the document. Stored version 1
 * documents load through upgradeTimeline (timeline-upgrade.ts). See
 * packages/timeline/SPEC.md, "Timeline v1" and its Phase 3 section.
 */
import '../basics/zod-config';
import { coverSettingsSchema } from './cover';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { captionTrackSchema } from '../render/captions';
import { musicChoiceSchema } from '../render/music';
import { beatMapSchema, canvasSchema } from '../templates/template-parts';
import { templateRefSchema } from '../templates/template-schema';
import { checkCompositionCopies, graphicCompositionSchema } from '../workspace/composition';
import { castStateSchema } from './cast-schema';
import { gradeSchema } from './grade';
import { timelineMixSchema } from './mix';
import { markerSchema, trackSchema } from './timeline-items';
import { checkTimeline } from './timeline-rules';
import { voiceoverSchema } from './voiceover';
import { authoredProgramSchema } from '../creation/authored-program';
import { RationalTime } from '../time/rational-time';

/** 2 since P3 (styleId, voiceover, mix, clip stillMotion and reframe, audio roles, graphics). */
export const TIMELINE_SCHEMA_VERSION = 2;

/** HFW1: the most composition copies a timeline keeps (the newest, those its graphics name first). */
export const MAX_TIMELINE_COMPOSITIONS = 48;

const timelineObjectSchema = z.object({
  schemaVersion: z.literal(TIMELINE_SCHEMA_VERSION),
  id: idSchema<'Timeline'>(),
  projectId: idSchema<'Project'>(),
  name: z.string().min(1).max(200),
  /** Bumped by every write. What renders and snapshots call the timeline's revision. */
  revision: z.int().min(1),
  canvas: canvasSchema,
  /** Resized copies default to their document shape until their own export choice is saved. */
  covers: z.array(coverSettingsSchema).max(4).optional(),
  exportAtCanvasSize: z.boolean().optional(),
  template: templateRefSchema.nullable(),
  /** The grid edits re-sync to. */
  beatMap: beatMapSchema.nullable(),
  tracks: z.array(trackSchema).min(1).max(16),
  /** Original speech may continue under B-roll; absent uses the legacy audible video clips. */
  speechTrackId: z
    .string()
    .regex(/^A[1-9]$/)
    .optional(),
  markers: z.array(markerSchema).max(500),
  cast: castStateSchema.nullable(),
  /** Render's caption track (P2-M5); null until captions were built. */
  captions: captionTrackSchema.nullable(),
  /** PRD G5: how the video gets its music. */
  music: musicChoiceSchema,
  /** The look (P3-V10). Render resolves: this, else the template version's styleId, else none. */
  styleId: idSchema<'Style'>().nullable(),
  /** The voiceover (P3-B6); its clips are on the audio track of role 'voice'. */
  voiceover: voiceoverSchema.nullable(),
  /** Ducking under the voice (P3-V6). */
  mix: timelineMixSchema,
  /**
   * HFW1: copies of the compositions this timeline's graphics are drawn with (each id and hash once, each id and
   * version once). `graphics.placeComposition` and `graphics.setComposition` add them; an item names one by id and
   * hash. Absent on a timeline from before HFW1.
   */
  graphicCompositions: z.array(graphicCompositionSchema).max(MAX_TIMELINE_COMPOSITIONS).optional(),
  /** Source-backed programs; proxies are caches and never replace these immutable source references. */
  authoredPrograms: z.array(authoredProgramSchema).max(48).optional(),
  /** EDT1-OPS: the whole video's colour grade (`timeline.setGrade`); each clip's own goes on top. Absent is none. */
  grade: gradeSchema.optional(),
  createdAt: z.int().nonnegative(),
  updatedAt: z.int().nonnegative(),
});

/** One variant's edit, its invariants checked (timeline-rules.ts), and its composition copies (HFW1). */
export const timelineSchema = timelineObjectSchema.superRefine((timeline, ctx) => {
  checkTimeline(timeline, ctx);
  if (
    timeline.speechTrackId &&
    !timeline.tracks.some(
      (track) => track.kind === 'audio' && track.enabled && track.id === timeline.speechTrackId,
    )
  )
    ctx.addIssue({
      code: 'custom',
      path: ['speechTrackId'],
      message: 'Speech must name an enabled audio track',
    });
  timeline.tracks.forEach((track, trackIndex) => {
    track.items.forEach((item, itemIndex) => {
      if (item.type === 'clip' && item.visualLayout && item.media.kind !== 'video')
        ctx.addIssue({
          code: 'custom',
          path: ['tracks', trackIndex, 'items', itemIndex, 'visualLayout'],
          message: 'Visual layouts require video media',
        });
    });
  });
  if (timeline.graphicCompositions)
    checkCompositionCopies(timeline.graphicCompositions, ctx, ['graphicCompositions']);
  for (const [trackIndex, track] of timeline.tracks.entries()) {
    for (const [itemIndex, item] of track.items.entries()) {
      if (item.type !== 'program') continue;
      const program = timeline.authoredPrograms?.find(
        (copy) => copy.id === item.program.id && copy.hash === item.program.hash,
      );
      if (track.kind !== 'video' || !program)
        ctx.addIssue({
          code: 'custom',
          path: ['tracks', trackIndex, 'items', itemIndex],
          message: 'A visual program needs its immutable source bundle',
        });
      else if (
        item.sourceStart.value < 0 ||
        RationalTime.compare(RationalTime.add(item.sourceStart, item.duration), program.duration) > 0
      )
        ctx.addIssue({
          code: 'custom',
          path: ['tracks', trackIndex, 'items', itemIndex, 'sourceStart'],
          message: 'Program range exceeds its source',
        });
    }
  }
});

export type Timeline = z.output<typeof timelineSchema>;
