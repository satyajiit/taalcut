// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: the tools a video's text is designed and placed with. The owner's videos drew every word in the default
 * face (no video had a Style, and nothing the AI could call made one), and their words sat "one small, one large,
 * one at top, one centre": each was solved on its own, by code.
 *
 * - `timeline.textLook` reads. Per role: the look it has now and how the reference set its letters (measured by the
 *   breakdown), with the bundled faces to choose from. Per group of texts (a run shown in turn at one place, or a
 *   single text): where it sits and how large, where the reference had it, what is under it in this video, which
 *   platform's own interface would cover it, and the solver's place as a candidate. And one line on the system.
 * - `timeline.designText` writes the look: one for every role in use, stated in full (the outline, the shadow and
 *   the box each given or null), saved as a Style of the video's own. It refuses a weight the face doesn't have,
 *   and the command refuses a role left without a look.
 * - `timeline.placeText` writes the place and the size of each group, exactly as stated, and answers with the same
 *   facts for what it placed. It never refuses or changes a place or a size. A placed text is one line for each
 *   line it is written on, whatever its size; `width` is the one statement that wraps it.
 *
 * Nothing here chooses a look, a place or a size: the tools report, the model states. The make's finish
 * (`video.done`) holds a video until both are stated. The words are kept short: a step in a small window loads
 * these schemas whole.
 */
import {
  CAPTION_FONTS,
  defineTool,
  designTextResultSchema,
  err,
  newId,
  NO_TOOL_RETRY,
  ok,
  placeTextResultSchema,
  styleKeySchema,
  TEXT_DESIGN_COMMAND,
  TEXT_PLACE_COMMAND,
  TEXT_REVEALS,
  textLookSchema,
  textPlaceSchema,
  ulidSchema,
  type AnyTool,
  type SubjectSource,
} from '@taalcut/core';
import { z } from 'zod';
import { platformAreas } from '../assembly/platform-areas';
import { InvalidMove } from '../errors';
import type { TimelineService } from '../service/service';
import type { TemplateReader } from '../service/templates';
import { editCommandTool } from './edit-command-tool';
import { toolKey } from './hash';
import { textFacts } from './text-group-facts';
import { placeTextOutputSchema, textLookOutputSchema } from './text-look-output';
import {
  roleLooks,
  templateOf,
  textStyleOf,
  weightRefusal,
  type TextFace,
  type TextStyleReader,
} from './text-look-read';

export interface TextDesignToolDeps {
  readonly service: Pick<TimelineService, 'read'>;
  readonly templates: TemplateReader;
  /** The Style a video names. Absent: a video's look now reads as none. */
  readonly textStyle?: TextStyleReader;
  /** The bundled faces with their class and weights (render's). Absent: the ids alone. */
  readonly textFaces?: readonly TextFace[];
  /** The people in the clips, for what is under a text. Absent: not reported. */
  readonly subjects?: SubjectSource;
}

const target = { projectId: ulidSchema('Project'), timelineId: ulidSchema('Timeline') };

const lookInput = z.object({
  role: styleKeySchema.describe('A role from timeline.textLook'),
  font: textLookSchema.shape.font.describe('A face and weight from timeline.textLook’s faces'),
  colour: textLookSchema.shape.colour.describe('#rrggbb, lower case'),
  outline: textLookSchema.shape.stroke.describe('Round the letters; null: none'),
  shadow: textLookSchema.shape.shadow.unwrap().describe('Under the letters; null: none'),
  box: textLookSchema.shape.background.describe('Behind the words; null: none'),
  letterSpacing: textLookSchema.shape.letterSpacing.describe('Extra, in em'),
  case: z.enum(['upper', 'lower', 'mixed']).optional(),
  reveal: z.enum(TEXT_REVEALS).optional().describe('How the texts come on'),
});

export const designTextToolInputSchema = z.object({
  ...target,
  name: z.string().trim().min(1).max(80).describe('A short name for the look'),
  looks: z.array(lookInput).min(1).max(16).describe('One for every role the text uses'),
});

const placeInput = z.object({
  itemId: z.string().min(1).max(64).describe('The group, from timeline.textLook'),
  asReel: z.boolean().optional().describe('true: the place and size the reference had'),
  x: textPlaceSchema.shape.x.describe('Share of the width: its left, centre or right, as align says'),
  y: textPlaceSchema.shape.y.describe('Share of the height: its middle'),
  align: textPlaceSchema.shape.align,
  size: textPlaceSchema.shape.size.describe('Capital height over frame height'),
  width: textPlaceSchema.shape.width.describe('Only to wrap: the widest a line may be, share of the width'),
});

export const placeTextToolInputSchema = z.object({
  ...target,
  groups: z.array(placeInput).min(1).max(60).describe('Every group you place, in one call'),
});

export function textDesignTools(deps: TextDesignToolDeps): AnyTool[] {
  const faces: readonly TextFace[] =
    deps.textFaces ??
    CAPTION_FONTS.map((id) => ({ id, family: id, class: 'unknown', weights: [100, 900] as const }));

  const read = defineTool({
    name: 'timeline.textLook',
    version: '1.0.0',
    description:
      "Reads a video's on-screen text. Per role: the look now (null: the default face) and the reference’s " +
      'measured look, with the faces to choose from. Per group (texts shown in turn at one place, or one text): ' +
      'its place and size now and in the reference, what is under it here, which platform’s interface would ' +
      'cover it, a clear place as a candidate. Read it before timeline.designText and timeline.placeText.',
    summary: "Reads a video's text: each role's look, each group's place and size, and what is under it.",
    tags: ['text', 'look', 'font', 'style', 'design', 'title', 'place', 'size'],
    input: z.object(target),
    output: textLookOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 30_000,
    retry: NO_TOOL_RETRY,
    idempotencyKey: (input) => toolKey('timeline.textLook', input),
    permission: { filesystem: { read: ['library'] } },
    run: async (input) => {
      const timeline = await deps.service.read(input.timelineId);
      if (!timeline.ok) return timeline;
      const template = await templateOf(timeline.value, deps);
      const style = (await textStyleOf(timeline.value, deps, template)) ?? null;
      const roles = roleLooks(timeline.value, style, template);
      const facts = await textFacts(timeline.value, template, deps);
      const areas = platformAreas(timeline.value.canvas);
      return ok({
        timelineId: timeline.value.id,
        revision: timeline.value.revision,
        style: style ? { id: style.id, name: style.name } : null,
        roles: roles.map((role) => ({ ...role, itemIds: [...role.itemIds] })),
        undesigned: roles.filter((role) => role.look === null).map((role) => role.role),
        faces: faces.map((face) => ({
          ...face,
          weights: [face.weights[0], face.weights[1]] as [number, number],
        })),
        groups: facts.groups,
        unplaced: facts.unplaced,
        system: facts.system,
        reading: facts.reading,
        platforms: areas ? { provisional: true as const, ...areas } : null,
      });
    },
  });

  const write = editCommandTool({
    command: TEXT_DESIGN_COMMAND,
    service: deps.service,
    description:
      "Designs a video's on-screen text: a look for every role timeline.textLook names, each stated in full, " +
      'saved as this video’s own Style. Start from the reference’s measured look unless the person asked for ' +
      'another. One undo step.',
    summary: "Designs a video's text: a look for every text role, saved as the video's own Style.",
    tags: ['text', 'look', 'font', 'style', 'design', 'title'],
    input: designTextToolInputSchema,
    output: designTextResultSchema,
    payload: async (call) => {
      for (const entry of call.looks) {
        const refused = weightRefusal(faces, entry.font.family, entry.font.weight);
        if (refused) return err(InvalidMove(undefined, { detail: `Role "${entry.role}": ${refused}` }));
      }
      return ok({
        projectId: call.projectId,
        timelineId: call.timelineId,
        // The Style's id is made here, so running the command again (a redo) makes no second Style.
        styleId: newId<'Style'>(),
        name: call.name,
        looks: call.looks.map((entry) => ({
          role: entry.role,
          look: {
            font: entry.font,
            colour: entry.colour,
            background: entry.box,
            stroke: entry.outline,
            shadow: entry.shadow,
            ...(entry.letterSpacing !== undefined ? { letterSpacing: entry.letterSpacing } : {}),
          },
          ...(entry.case ? { case: entry.case } : {}),
          ...(entry.reveal ? { reveal: entry.reveal } : {}),
        })),
      });
    },
  });

  const place = defineTool({
    name: TEXT_PLACE_COMMAND,
    version: '1.0.0',
    description:
      "Places a video's on-screen text: for each group its place, alignment and size, or asReel. Texts shown in " +
      'turn at one place move as one. A text draws on one line at any size; only a line break in its words or a ' +
      'width you state breaks it. What you state is applied exactly, with one exception: a group stated past the ' +
      'frame’s edge is moved the least that keeps it inside the frame, and a line wider than the frame wraps at ' +
      'the frame’s width (atFrameEdge: true). The answer gives facts for each group (capital height in px, the ' +
      'lines each text draws on, faces under it, a platform’s interface over it) and the sizes and places as ' +
      'one system. A text the person placed stays. One undo step.',
    summary: "Places a video's text: each group's place, alignment and size, as stated.",
    tags: ['text', 'place', 'position', 'move', 'size', 'bigger', 'smaller', 'align', 'title'],
    input: placeTextToolInputSchema,
    output: placeTextOutputSchema,
    costClass: 'local',
    sideEffect: 'write',
    command: TEXT_PLACE_COMMAND,
    timeoutMs: 30_000,
    retry: NO_TOOL_RETRY,
    idempotencyKey: (input) => toolKey(TEXT_PLACE_COMMAND, input),
    run: async (input, ctx) => {
      const before = await deps.service.read(input.timelineId);
      if (!before.ok) return before;
      const done = await ctx.dispatch({ ...input, revision: before.value.revision });
      if (!done.ok) return done;
      const receipt = placeTextResultSchema.parse(done.value);
      const after = await deps.service.read(input.timelineId);
      if (!after.ok) return after;
      const template = await templateOf(after.value, deps);
      const stated = new Set(input.groups.map((group) => group.itemId));
      const facts = await textFacts(after.value, template, deps, stated);
      return ok({
        timelineId: receipt.timelineId,
        revision: receipt.revision,
        affectedItemIds: receipt.affectedItemIds,
        groups: facts.groups,
        unplaced: facts.unplaced,
        system: facts.system,
        reading: facts.reading,
        platformsNote: facts.platformsNote,
      });
    },
  });

  return [read as AnyTool, write, place as AnyTool];
}
