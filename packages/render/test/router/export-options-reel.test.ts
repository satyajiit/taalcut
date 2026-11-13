// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * renders.exportOptions' music part since REF1: the reel's own music is available when the template keeps a reel
 * with sound that is still on disk, nothing needs acknowledging, and the "add this sound in the app" steps carry the
 * reel's link and its sound's credit, so turning the music off leaves complete steps.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FrameRate, newId, type MusicChoice, type TemplateId, type Timeline } from '@taalcut/core';
import { exportOptions } from '../../src/router/export-options';
import { tempDir } from '../support/media';
import { makeTimeline } from '../support/timeline';
import { fakeWorld, reelMedia, type FakeWorld } from './fixtures';

const rate = FrameRate.of(30);
const LINK = 'https://www.instagram.com/reel/EXAMPLE123/';

describe('export options: the reel’s music', () => {
  let work: Awaited<ReturnType<typeof tempDir>>;
  let world: FakeWorld;
  let reelFile: string;

  beforeAll(async () => {
    work = await tempDir('export-options-reel');
    world = await fakeWorld(work.dir);
    reelFile = join(work.dir, 'reference.mp4');
    await writeFile(reelFile, 'not really a film');
  });
  afterAll(async () => work?.dispose());

  /** A timeline made from a template that keeps (or doesn't keep) its reel, with `music` chosen. */
  const fromTemplate = (music: (templateId: TemplateId) => MusicChoice | undefined): Timeline => {
    const templateId = newId<'Template'>();
    const chosen = music(templateId);
    const timeline = {
      ...makeTimeline({ rate, items: [{ frames: 300 }], ...(chosen ? { music: chosen } : {}) }),
      template: { id: templateId, version: 2 },
    };
    world.timelines.set(timeline.id, timeline);
    return timeline;
  };
  const optionsOf = async (timeline: Timeline) => {
    const options = await exportOptions(world.deps, {
      projectId: timeline.projectId,
      timelineId: timeline.id,
    });
    if (!options.ok) throw new Error(options.error.code);
    return options.value.music;
  };

  it('offers the kept reel’s music with no acknowledgement, and steps with its link and credit', async () => {
    const timeline = fromTemplate((templateId) => ({ path: 'referenceAudio', templateId, gainDb: 0 }));
    const templateId = timeline.template!.id;
    world.reels.set(templateId, { media: reelMedia(), path: reelFile });
    world.templateVersions.set(templateId, {
      origin: { kind: 'reference', url: LINK },
      audio: { sound: { title: ' Golden Hour ', artist: 'Someone' } },
    });
    const music = await optionsOf(timeline);
    expect(music).toMatchObject({
      current: { path: 'referenceAudio', templateId },
      referenceAudioAvailable: true,
      referenceAudioAcknowledged: true,
    });
    // The steps are there with the music on too, so turning it off shows them at once.
    expect(music.platformSound).toMatchObject({ referenceUrl: LINK, soundLabel: 'Golden Hour · Someone' });
    expect(music.platformSound?.steps.map((step) => step.platform)).toEqual(['shorts', 'reels', 'tiktok']);
  });

  it('with the music off, the steps still name the reel; a credit with only a title is the title', async () => {
    const timeline = fromTemplate(() => ({ path: 'platformSound' }));
    world.templateVersions.set(timeline.template!.id, {
      origin: { kind: 'reference', url: LINK },
      audio: { sound: { title: 'Only a title', artist: null } },
    });
    const music = await optionsOf(timeline);
    expect(music.referenceAudioAvailable).toBe(false);
    expect(music.platformSound).toMatchObject({ referenceUrl: LINK, soundLabel: 'Only a title' });
  });

  it('is unavailable for a silent reel, a reel whose file is gone, or a template that keeps none', async () => {
    const silent = fromTemplate(() => undefined);
    world.reels.set(silent.template!.id, { media: reelMedia(false), path: reelFile });
    const gone = fromTemplate(() => undefined);
    world.reels.set(gone.template!.id, { media: reelMedia(), path: join(work.dir, 'deleted.mp4') });
    const none = fromTemplate(() => undefined);
    for (const timeline of [silent, gone, none])
      expect((await optionsOf(timeline)).referenceAudioAvailable).toBe(false);
  });

  it('gives steps without a link or credit when the template version can’t be read, or has none to give', async () => {
    const unreadable = fromTemplate(() => undefined);
    expect((await optionsOf(unreadable)).platformSound).toMatchObject({
      referenceUrl: null,
      soundLabel: null,
    });
    const fromFile = fromTemplate(() => undefined);
    world.templateVersions.set(fromFile.template!.id, {
      origin: { kind: 'reference', url: null },
      audio: { sound: null },
    });
    expect((await optionsOf(fromFile)).platformSound).toMatchObject({ referenceUrl: null, soundLabel: null });
    const notHttps = fromTemplate(() => undefined);
    world.templateVersions.set(notHttps.template!.id, { origin: { url: 'javascript:alert(1)' } });
    expect((await optionsOf(notHttps)).platformSound?.referenceUrl).toBeNull();
  });

  it('gives no steps for an own track on a timeline with no template', async () => {
    const own = makeTimeline({
      rate,
      items: [{ frames: 300 }],
      music: { path: 'ownTrack', assetId: newId<'Asset'>(), offset: { value: 0, rate }, gainDb: 0 },
    });
    world.timelines.set(own.id, own);
    expect((await optionsOf(own)).platformSound).toBeNull();
  });
});
