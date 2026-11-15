// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: a made video's text is designed. `timeline.textLook` reads the roles a video's text uses with the
 * reference's measured look; `timeline.designText` saves a look for every role as the video's own Style; and the
 * make's finish (`checkVideoDone`) holds a video whose text would be drawn in the default face, and lets it pass
 * once the Style has the look and the text a stated place (text-place.test.ts).
 */
import { describe, expect, it } from 'vitest';
import type { CommandOrigin } from '@taalcut/core';
import { checkVideoDone, defaultLookRefusal } from '../src/match/video-done';
import { memoryTemplateReader } from '../src/service/templates';
import { roleLooks, weightRefusal, type TextFace } from '../src/tools/text-look-read';
import {
  HEAVY,
  measuredWorld,
  memoryStyles,
  passingReport,
  styledVideo as video,
} from './fixtures/text-design';
import { lyricWorld, madeVideo, textWorld, wordsOf } from './placement/lyric-world';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };

describe('timeline.textLook', () => {
  it('names each role with its look now and the reference’s measured look, in the units a look is stated in', async () => {
    const { w, target } = await video();
    const read = await w.call('timeline.textLook', target);
    if (!read.ok) throw new Error(read.error.code);
    expect(read.value.style).toBeNull();
    expect(read.value.undesigned).toEqual(['label']);
    const [role] = read.value.roles as {
      role: string;
      texts: number;
      look: unknown;
      reel: Record<string, unknown>;
    }[];
    expect(role).toMatchObject({ role: 'label', texts: 7, look: null });
    // The role's words vote, so the one sure misread moves nothing; the outline is 0.09 of a 55 px capital on
    // this 1080×1920 video. The confidence is the readings' mean.
    expect(role!.reel).toMatchObject({
      measured: 7,
      of: 7,
      lettersMeasured: 7,
      colour: '#ffffff',
      weight: 800,
      class: 'sans',
      outline: { colour: '#000000', widthPx: 5 },
      shadow: false,
      width: 'normal',
      case: 'upper',
      arrives: 'pop',
      confidence: 0.64,
    });
    // No rule comes with it: the reading fact, and the platforms' areas marked provisional.
    expect(read.value.rules).toBeUndefined();
    expect(read.value.reading).toBe('Capitals under 36 px on this video are hard to read on a phone.');
    expect((read.value.faces as unknown[]).length).toBeGreaterThan(8);
  });

  it('a role the breakdown did not measure has no reference look, and nothing is made up for it', () => {
    const world = lyricWorld();
    const timeline = { tracks: [], canvas: { width: 1080, height: 1920 } } as never;
    expect(roleLooks(timeline, null, world.template)).toEqual([]);
  });
});

describe('timeline.designText', () => {
  it('saves a look for every role as the video’s own Style, and dresses the role’s texts', async () => {
    const { w, target, styles, now } = await video();
    const done = await w.call('timeline.designText', { ...target, name: 'Heavy white', looks: [HEAVY] });
    if (!done.ok) throw new Error(`${done.error.code} ${done.error.detail ?? ''}`);
    const style = styles.all.get(done.value.styleId as string)!;
    expect(now().styleId).toBe(style.id);
    expect(style).toMatchObject({ name: 'Heavy white', kind: 'look' });
    expect(style.madeFrom).toEqual({ templateId: w.template.id, version: w.template.version });
    expect(style.textStyles.label).toEqual({
      font: { family: 'montserrat', weight: 800 },
      colour: '#ffffff',
      background: null,
      stroke: { colour: '#000000', widthPx: 5 },
      shadow: null,
    });
    // With no Style before it, the Style's own colours and fonts are read off the stated look.
    expect(style.colours).toMatchObject({ text: '#ffffff', background: '#000000' });
    expect(style.fonts.heading).toEqual({ family: 'montserrat', weight: 800 });
    for (const word of wordsOf(now())) {
      expect(word.appearance.case).toBe('upper');
      expect(word.reveal).toBe('pop');
    }
    expect(defaultLookRefusal(now(), style)).toBeNull();
  });

  it('one undo puts the video’s Style and texts back; the next design keeps the rest of the Style', async () => {
    const { w, target, styles, now } = await video();
    const before = now();
    const first = await w.call('timeline.designText', { ...target, name: 'Heavy white', looks: [HEAVY] });
    if (!first.ok) throw new Error(first.error.code);
    const second = await w.call('timeline.designText', {
      ...target,
      name: 'Thin serif',
      looks: [
        { ...HEAVY, font: { family: 'playfairDisplay', weight: 400 }, colour: '#f4d35e', outline: null },
      ],
    });
    if (!second.ok) throw new Error(second.error.code);
    expect(styles.all.size).toBe(2);
    const style = styles.all.get(second.value.styleId as string)!;
    expect(style.textStyles.label!.font.family).toBe('playfairDisplay');
    // The first design's colours stay: only the role's look changed.
    expect(style.colours).toEqual(styles.all.get(first.value.styleId as string)!.colours);
    // One undo: the video is back on the first design, its texts as that design left them.
    const undone = await w.bus.undo(target.projectId, ui);
    expect(undone.ok).toBe(true);
    expect(now().styleId).toBe(first.value.styleId);
    // And again: no Style, as the make left it. The Styles made stay in the library.
    await w.bus.undo(target.projectId, ui);
    expect(now().styleId).toBeNull();
    expect(wordsOf(now()).map((word) => word.reveal)).toEqual(wordsOf(before).map((word) => word.reveal));
    expect(styles.all.size).toBe(2);
    expect(before.styleId).toBeNull();
  });

  it('refuses a role left without a look, and a weight the face does not have', async () => {
    const { w, target } = await video();
    const other = await w.call('timeline.designText', {
      ...target,
      name: 'Titles only',
      looks: [{ ...HEAVY, role: 'title' }],
    });
    expect(other.ok).toBe(false);
    if (!other.ok)
      expect(other.error.detail).toBe(
        'This video\'s text also uses "label" (7 texts). Give a look for every role its text uses, in one call.',
      );
    const faces: TextFace[] = [
      { id: 'anton', family: 'Anton', class: 'condensed', weights: [400, 400] },
      { id: 'oswald', family: 'Oswald', class: 'condensed', weights: [200, 700] },
    ];
    expect(weightRefusal(faces, 'anton', 700)).toBe(
      'Anton (anton) has only weight 400, not 700. Give a weight it has, or a condensed face that draws 700: oswald.',
    );
    expect(weightRefusal(faces, 'oswald', 500)).toBeNull();
  });
});

describe('a make learns early that the text has no look and no stated place', () => {
  it('timeline.get says what is missing, with the tools to call before a draft, until both are stated', async () => {
    const { w, target, now } = await video();
    const line = async () => {
      const read = await w.call('timeline.get', { timelineId: target.timelineId });
      if (!read.ok) throw new Error(read.error.code);
      return read.value.textLook;
    };
    expect(await line()).toBe(
      'No designed look yet for the text (label). No stated place or size yet for 7 of its texts. Before ' +
        'render.draft: timeline.textLook, then timeline.designText and timeline.placeText.',
    );
    const done = await w.call('timeline.designText', { ...target, name: 'Heavy white', looks: [HEAVY] });
    expect(done.ok).toBe(true);
    expect(await line()).toBe(
      'No stated place or size yet for 7 of its texts. Before render.draft: timeline.textLook, then ' +
        'timeline.placeText.',
    );
    const placed = await w.call('timeline.placeText', {
      ...target,
      groups: [{ itemId: wordsOf(now())[0]!.id, asReel: true }],
    });
    expect(placed.ok).toBe(true);
    expect(await line()).toBeUndefined();
  });

  it('says nothing where no Style can be read, or the video has no text', async () => {
    const world = measuredWorld();
    const made = await madeVideo(world);
    const read = await made.w.call('timeline.get', { timelineId: made.timeline.id });
    if (!read.ok) throw new Error(read.error.code);
    expect(read.value.textLook).toBeUndefined();
  });
});

describe('a video with no text at all is never held', () => {
  it('timeline.get has no line about the text, and video.done passes with no Style', async () => {
    const styles = memoryStyles();
    const world = textWorld([]);
    const made = await madeVideo(world, [], { styles, templates: memoryTemplateReader([world.template]) });
    expect(wordsOf(made.timeline)).toEqual([]);
    const read = await made.w.call('timeline.get', { timelineId: made.timeline.id });
    if (!read.ok) throw new Error(read.error.code);
    expect(read.value.textLook).toBeUndefined();
    const done = checkVideoDone({
      timeline: made.timeline,
      slots: null,
      draft: { renderId: 'r1', timelineRevision: made.timeline.revision, report: passingReport('r1') },
      reasons: [],
      textStyle: null,
    });
    expect(done.verdict.verdict).toBe('pass');
  });
});

describe('video.done holds the text to a designed look', () => {
  it('refuses text in the default face, in words that name the roles and the tools; passes with a Style', async () => {
    const { w, target, styles, now, drafted } = await video();
    // Its place stated first, so only the look is missing.
    const placed = await w.call('timeline.placeText', {
      ...target,
      groups: [{ itemId: wordsOf(now())[0]!.id, asReel: true }],
    });
    expect(placed.ok).toBe(true);
    // No Style can be read at all (no style store): the look is not held, as before TXT1.
    expect(checkVideoDone(drafted()).verdict.verdict).toBe('pass');
    const refused = checkVideoDone({ ...drafted(), textStyle: null });
    expect(refused.verdict).toEqual({
      verdict: 'retry',
      reason:
        'The video\'s on-screen text has no designed look and would be drawn in the default face: "label" ' +
        '(7 texts). Read timeline.textLook (the roles, the reference’s measured look, the faces), then give every ' +
        'role a look with timeline.designText, starting from the reference’s unless the person asked for another. ' +
        'Then render.draft again and call video.done.',
    });
    const done = await w.call('timeline.designText', { ...target, name: 'Heavy white', looks: [HEAVY] });
    if (!done.ok) throw new Error(done.error.code);
    const style = styles.all.get(done.value.styleId as string)!;
    expect(checkVideoDone({ ...drafted(), textStyle: style }).verdict.verdict).toBe('pass');
    // A Style without the role's look is no design either.
    expect(checkVideoDone({ ...drafted(), textStyle: { textStyles: {} } }).verdict.verdict).toBe('retry');
  });

  it('with neither a look nor a place, one refusal names both', async () => {
    const { drafted } = await video();
    const { verdict } = checkVideoDone({ ...drafted(), textStyle: null });
    expect(verdict.verdict).toBe('retry');
    const reason = verdict.verdict === 'retry' ? verdict.reason : '';
    expect(reason).toContain('timeline.designText');
    expect(reason).toContain("7 of the video's on-screen texts have no stated place or size yet");
    expect(reason).toContain('timeline.placeText');
  });
});
