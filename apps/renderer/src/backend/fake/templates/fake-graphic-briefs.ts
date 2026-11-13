// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample model output: data, never translated */

/**
 * DSG1-READ in the renderer's fake: the Coast road trip's graphics read as a motion designer would (a title on the
 * beat, a lower third, and a fish stall's sign Taalcut took for footage), and template.graphic.set and
 * template.graphic.edit as main answers them, so the review's briefs can be seen and tested without the app. The
 * real ones are @taalcut/templates' (edits/graphic-edits.ts).
 */
import {
  TemplateOverlayNotFound,
  type GraphicBrief,
  type GraphicBriefPatch,
  type Id,
  type Template,
} from '@taalcut/core';
import type { SlotEditResult } from './template-edits';

type Brief = Pick<GraphicBrief, 'graphic' | 'kind' | 'what' | 'role'> & Partial<GraphicBrief>;

const brief = (overlayId: Id<'TextOverlay'>, read: Brief): GraphicBrief => ({
  overlayId,
  reason: null,
  answers: null,
  look: { words: '', platform: 'neutral', shadow: false, avatar: false },
  motion: { words: '', typingSeconds: null },
  timing: { cue: 'free', words: 'not timed to a cut, a beat or speech' },
  people: { words: 'in the middle of the frame (no people were measured)' },
  source: 'model',
  confidence: 0.85,
  ...read,
});

/** The Coast road trip's reading of its four text lines. */
export function coastRoadGraphics(template: Template): Template {
  const idOf = (words: string) => template.text.find((item) => item.text === words)?.id;
  const [day, speed, worth, fish] = ['DAY 1', 'SPEED LIMIT 50', 'worth every mile', 'FRESH FISH'].map(idOf);
  if (!day || !speed || !worth || !fish) return template;
  const briefs: GraphicBrief[] = [
    brief(day, {
      graphic: true,
      kind: 'title',
      what: 'the trip’s day title',
      role: 'hook',
      look: {
        words: 'big white display type that slides up word by word, no shape behind it',
        platform: 'neutral',
        shadow: true,
        avatar: false,
      },
      motion: { words: 'comes on word by word, fades out', typingSeconds: null },
      timing: { cue: 'beat', words: 'comes on on a beat' },
      people: { words: 'in the top third of the frame, away from the people' },
    }),
    brief(speed, {
      graphic: true,
      kind: 'label',
      what: 'a road sign’s words',
      role: 'context',
      look: { words: 'white words on the picture', platform: 'neutral', shadow: false, avatar: false },
      // The model took it for a graphic; the text stage still doubts it, so the review asks.
      confidence: 0.45,
    }),
    brief(worth, {
      graphic: true,
      kind: 'lowerThird',
      what: 'the closing line',
      role: 'payoff',
      look: {
        words: 'a dark teal band across the bottom with white sans type, square ends',
        platform: 'neutral',
        shadow: false,
        avatar: false,
      },
      motion: { words: 'fades in, fades out', typingSeconds: null },
      timing: { cue: 'cut', words: 'comes on at a cut' },
      people: { words: 'in the bottom third of the frame, away from the people' },
    }),
    brief(fish, {
      graphic: false,
      reason: 'Painted on the stall’s awning: it moves with the camera and a gull flies in front of it.',
      kind: 'other',
      what: 'the fish stall’s sign',
      role: 'other',
    }),
  ];
  return {
    ...template,
    graphics: {
      uses: [],
      reading: {
        version: 1,
        prompt: 'graphic-brief/1',
        model: { provider: 'local-runtime', model: 'qwen3.5-4b', local: true },
        briefs,
        system: {
          tokens: { platform: 'neutral', fills: ['#0f2a3a'], text: ['#ffffff'], cornerRadius: 0, font: null },
          conversation: [],
          stack: null,
          words: '3 other graphics in the same look.',
        },
      },
    },
  };
}

function withBrief(
  template: Template,
  overlayId: Id<'TextOverlay'>,
  change: (brief: GraphicBrief) => GraphicBrief,
  now: number,
): SlotEditResult {
  const reading = template.graphics?.reading;
  if (!reading?.briefs.some((item) => item.overlayId === overlayId))
    return {
      ok: false,
      reason: 'No brief',
      error: TemplateOverlayNotFound(undefined, { detail: 'No brief' }),
    };
  return {
    ok: true,
    template: {
      ...template,
      version: template.version + 1,
      parentVersion: template.version,
      createdAt: now,
      graphics: {
        ...template.graphics!,
        reading: {
          ...reading,
          briefs: reading.briefs.map((item) =>
            item.overlayId === overlayId ? { ...change(item), source: 'person' } : item,
          ),
        },
      },
    },
  };
}

/** template.graphic.set: Not a graphic (false) or its restore (true). */
export function setGraphic(
  template: Template,
  overlayId: Id<'TextOverlay'>,
  graphic: boolean,
  now: number,
): SlotEditResult {
  return withBrief(
    template,
    overlayId,
    (item) => ({ ...item, graphic, reason: graphic ? null : item.reason }),
    now,
  );
}

/** template.graphic.edit: the person's words and kinds; the facts stay. */
export function editGraphic(
  template: Template,
  overlayId: Id<'TextOverlay'>,
  patch: GraphicBriefPatch,
  now: number,
): SlotEditResult {
  return withBrief(
    template,
    overlayId,
    (item) => ({
      ...item,
      ...(patch.kind ? { kind: patch.kind } : {}),
      ...(patch.what !== undefined ? { what: patch.what } : {}),
      ...(patch.role ? { role: patch.role } : {}),
      ...(patch.look !== undefined ? { look: { ...item.look, words: patch.look } } : {}),
      ...(patch.motion !== undefined ? { motion: { ...item.motion, words: patch.motion } } : {}),
      ...(patch.timing !== undefined ? { timing: { ...item.timing, words: patch.timing } } : {}),
      ...(patch.people !== undefined ? { people: { words: patch.people } } : {}),
    }),
    now,
  );
}
