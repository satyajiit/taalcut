// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** timeline.setStyle (P3-V10, P3-V16): the Style and its caption look in one undo step. */
import { TIMELINE_COMMANDS, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { setStyle } from '../../src/styles/set-style';
import { commandWorld, ui } from '../fixtures/command-world';
import { BRAND_CAPTIONS, makeStyle, memoryStyles, withCaptions } from '../fixtures/styles';
import { buildTimeline } from '../fixtures/timeline';

function video(captions = true): Timeline {
  const { timeline } = buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }] });
  return captions ? withCaptions(timeline) : timeline;
}

const target = (timeline: Timeline) => ({ projectId: timeline.projectId, timelineId: timeline.id });

describe('timeline.setStyle', () => {
  it('names the Style, puts its caption look on the captions, and undoes both in one step', async () => {
    const style = makeStyle(BRAND_CAPTIONS);
    const world = commandWorld({ styles: memoryStyles([style]) });
    const timeline = video();
    await world.seed(timeline);

    const done = await world.dispatch(TIMELINE_COMMANDS.setStyle, { ...target(timeline), styleId: style.id });
    expect(done.ok && done.value).toMatchObject({ timelineId: timeline.id, revision: 2 });
    const doc = world.doc(timeline.id);
    expect(doc.styleId).toBe(style.id);
    expect(doc.captions).toEqual({ ...timeline.captions, style: BRAND_CAPTIONS, styleSource: 'preset' });

    expect((await world.bus.undo(timeline.projectId, ui)).ok).toBe(true);
    expect(world.doc(timeline.id).styleId).toBeNull();
    expect(world.doc(timeline.id).captions).toEqual(timeline.captions);
    expect(await world.bus.history(timeline.projectId)).toMatchObject({ value: { undo: null } });
  });

  it('leaves the captions be when the Style has no caption look, and a video without captions gets none', async () => {
    const plain = makeStyle(null, 'Plain');
    const branded = makeStyle(BRAND_CAPTIONS);
    const world = commandWorld({ styles: memoryStyles([plain, branded]) });
    const captioned = video();
    const bare = video(false);
    await world.seed(captioned, bare);

    expect(
      (await world.dispatch(TIMELINE_COMMANDS.setStyle, { ...target(captioned), styleId: plain.id })).ok,
    ).toBe(true);
    expect(world.doc(captioned.id).captions).toEqual(captioned.captions);
    expect(
      (await world.dispatch(TIMELINE_COMMANDS.setStyle, { ...target(bare), styleId: branded.id })).ok,
    ).toBe(true);
    expect(world.doc(bare.id).styleId).toBe(branded.id);
    expect(world.doc(bare.id).captions).toBeNull();
  });

  it('clears the Style with null, keeping the caption look, without a Style store', async () => {
    const world = commandWorld();
    const style = makeStyle(BRAND_CAPTIONS);
    const timeline = setStyle(video(), style);
    if (!timeline.ok) throw timeline.error;
    await world.seed(timeline.value.timeline);

    const done = await world.dispatch(TIMELINE_COMMANDS.setStyle, {
      ...target(timeline.value.timeline),
      styleId: null,
    });
    expect(done.ok).toBe(true);
    expect(world.doc(timeline.value.timeline.id).styleId).toBeNull();
    expect(world.doc(timeline.value.timeline.id).captions?.style).toEqual(BRAND_CAPTIONS);
  });

  it('refuses an unknown Style, and a Style without the store', async () => {
    const timeline = video();
    const world = commandWorld({ styles: memoryStyles([]) });
    await world.seed(timeline);
    const missing = makeStyle(null).id;
    const unknown = await world.dispatch(TIMELINE_COMMANDS.setStyle, {
      ...target(timeline),
      styleId: missing,
    });
    expect(!unknown.ok && unknown.error).toMatchObject({
      code: 'timeline.style_not_found',
      params: { styleId: missing },
    });

    const bare = commandWorld();
    await bare.seed(timeline);
    const refused = await bare.dispatch(TIMELINE_COMMANDS.setStyle, {
      ...target(timeline),
      styleId: missing,
    });
    expect(!refused.ok && refused.error.code).toBe('core.not_implemented');
    expect(world.doc(timeline.id)).toEqual(timeline);
  });

  it('writes nothing when the video already has the look', async () => {
    const style = makeStyle(BRAND_CAPTIONS);
    const world = commandWorld({ styles: memoryStyles([style]) });
    const timeline = video();
    await world.seed(timeline);
    await world.dispatch(TIMELINE_COMMANDS.setStyle, { ...target(timeline), styleId: style.id });
    const again = await world.dispatch(TIMELINE_COMMANDS.setStyle, {
      ...target(timeline),
      styleId: style.id,
    });
    expect(again.ok && again.value).toMatchObject({ timelineId: timeline.id, revision: 2 });
  });
});
