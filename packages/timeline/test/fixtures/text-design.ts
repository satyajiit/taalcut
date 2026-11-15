// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: the owner's lyric made into a video with a style store, for the tests of its text's look and place. The
 * reel's words are measured as the breakdown measures them: heavy white letters with a black outline, in capitals.
 */
import {
  err,
  NotFoundError,
  ok,
  type QaReport,
  type Style,
  type StyleStore,
  type Template,
} from '@taalcut/core';
import { memoryTemplateReader } from '../../src/service/templates';
import { lyricWorld, madeVideo, type HeadsByClip, type LyricOptions } from '../placement/lyric-world';
import type { World } from './casting';

export function memoryStyles(): Pick<StyleStore, 'get' | 'create'> & { readonly all: Map<string, Style> } {
  const all = new Map<string, Style>();
  return {
    all,
    get: async (styleId) => {
      const found = all.get(styleId);
      return found ? ok(found) : err(NotFoundError({ entity: 'style', id: styleId }));
    },
    create: async (style) => {
      all.set(style.id, style);
      return ok(style);
    },
  };
}

/** One word of the seven is misread, and surely: pink, light, wide, no outline (a still picture under it). */
export function measuredWorld(options: LyricOptions = {}): World {
  const world = lyricWorld(options);
  const template: Template = {
    ...world.template,
    text: world.template.text.map((overlay, index) => {
      const misread = index === 2;
      return {
        ...overlay,
        reveal: 'pop',
        appearance: { ...overlay.appearance, case: 'upper' },
        design: {
          kind: 'plain',
          colors: { fill: null, text: misread ? '#ff5ca8' : '#ffffff', stroke: misread ? null : '#000000' },
          cornerRadius: 0,
          tail: 'none',
          font: { class: 'sans', weight: misread ? 300 : 800 },
          motion: { enter: 'pop', exit: 'none', typing: false },
          type: {
            stem: misread ? 0.08 : 0.2,
            outline: misread ? null : 0.09,
            shadow: misread,
            width: misread ? 'wide' : 'normal',
            spacing: 0.12,
            confidence: misread ? 0.85 : 0.6,
          },
          confidence: 0.8,
        },
      };
    }),
  };
  return { ...world, template };
}

export const HEAVY = {
  role: 'label',
  font: { family: 'montserrat', weight: 800 },
  colour: '#ffffff',
  outline: { colour: '#000000', widthPx: 5 },
  shadow: null,
  box: null,
  case: 'upper',
  reveal: 'pop',
} as const;

export const passingReport = (renderId: string): QaReport => ({
  version: 1,
  renderId: renderId as QaReport['renderId'],
  round: 1,
  verdict: 'passed',
  presetId: 'reels',
  checks: [],
  overrides: [],
  createdAt: 0,
});

/** A video made from `world` (default the measured lyric) where Styles can be read, its clips' heads as given. */
export async function styledVideo(heads: HeadsByClip = [], world: World = measuredWorld()) {
  const styles = memoryStyles();
  const made = await madeVideo(world, heads, { styles, templates: memoryTemplateReader([world.template]) });
  const target = { projectId: made.timeline.projectId, timelineId: made.timeline.id };
  const now = () => made.w.store.docs.get(made.timeline.id)!;
  /** A draft of the video as it is now, with nothing failing on it. */
  const drafted = () => ({
    timeline: now(),
    slots: null,
    draft: { renderId: 'r1', timelineRevision: now().revision, report: passingReport('r1') },
    reasons: [],
  });
  return { ...made, styles, target, now, drafted };
}
