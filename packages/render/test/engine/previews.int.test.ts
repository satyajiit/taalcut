// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Preview sessions with the bundled FFmpeg (the sound is mixed for real):
 * the session folder main serves, proxies first, refresh in place, close,
 * the idle sweep, media folders, and the reel's own music (REF1) played
 * from the reel the template keeps, and left out once that reel is gone.
 */
import { readdir, readFile, stat, utimes, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FrameRate, newId, ok, type AssetId, type Timeline } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPreviewSessions, PREVIEW_IDLE_MS } from '../../src/engine/previews';
import { FONTS_DIR } from '../support/fonts';
import { colourClip, findTestMedia, mediaContext, tempDir } from '../support/media';
import { makeTimeline } from '../support/timeline';
import { fakeWorld, reelMedia, type FakeWorld } from '../router/fixtures';

const media = await findTestMedia('previews');
const rate = FrameRate.of(30);

describe.skipIf(!media.binaries)('preview sessions', { timeout: 240_000 }, () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let world: FakeWorld;
  let red: AssetId;
  let blue: AssetId;

  const timelineOf = (overrides: Partial<Parameters<typeof makeTimeline>[0]> = {}): Timeline => {
    const timeline = makeTimeline({
      rate,
      items: [
        { frames: 30, assetId: red, sourceStart: 0, mediaFrames: 60 },
        { frames: 30, assetId: blue, sourceStart: 0, mediaFrames: 60 },
      ],
      texts: [{ start: 0, frames: 30, text: 'Title' }],
      ...overrides,
    });
    world.timelines.set(timeline.id, timeline);
    return timeline;
  };
  const tokenOf = (url: string) => /^app:\/\/preview\/([0-9a-f]{32})\//.exec(url)![1]!;

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('previews');
    world = await fakeWorld(join(work.dir, 'world'), { ctx });
    red = newId<'Asset'>();
    blue = newId<'Asset'>();
    for (const [asset, colour] of [
      [red, 'red'],
      [blue, 'blue'],
    ] as const) {
      const file = join(work.dir, `${colour}.mp4`);
      await colourClip(ctx, file, { colour, frames: 60, rate: '30', size: '270x480' });
      world.originals.set(asset, file);
    }
  });
  afterAll(async () => work?.dispose());

  it('writes a session folder main can serve, with proxies first and the sound mixed', async () => {
    const proxy = join(work.dir, 'red-proxy.mp4');
    await colourClip(ctx, proxy, { colour: 'red', frames: 60, rate: '30', size: '135x240' });
    world.proxies.set(red, proxy);
    const timeline = timelineOf();
    const previews = createPreviewSessions(world.deps);
    const opened = await previews.open(timeline.projectId, timeline.id);
    if (!opened.ok) throw new Error(`${opened.error.code} ${opened.error.detail ?? ''}`);
    expect(opened.value.url).toMatch(/^app:\/\/preview\/[0-9a-f]{32}\/index\.html\?rev=0$/);
    expect(opened.value).toMatchObject({ revision: 0, width: 1080, height: 1920, durationFrames: 60, rate });
    const dir = join(world.deps.folders.preview, tokenOf(opened.value.url));
    const [first, second] = timeline.tracks[0]!.items;
    expect((await stat(join(dir, 'media', `${first!.id}.mp4`))).ino).toBe((await stat(proxy)).ino);
    expect((await stat(join(dir, 'media', `${second!.id}.mp4`))).ino).toBe(
      (await stat(world.originals.get(blue)!)).ino,
    );
    for (const file of ['index.html', 'tc.css', 'tc.js', '_hf/runtime.js', 'audio/mix.m4a']) {
      expect((await stat(join(dir, file))).isFile()).toBe(true);
    }
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Record<string, string>;
    expect(Object.keys(manifest).length).toBeGreaterThan(0);
    for (const [path, file] of Object.entries(manifest)) {
      expect(path.startsWith('fonts/')).toBe(true);
      expect(file.startsWith(FONTS_DIR)).toBe(true);
    }
    const html = await readFile(join(dir, 'index.html'), 'utf8');
    expect(html).toContain('<audio id="tc-mix"');
    expect(html).toContain('<script src="_hf/runtime.js"></script>');
    world.proxies.delete(red);
    await previews.closeAll();
  });

  it('refreshes in place at the next revision and drops what the timeline no longer uses', async () => {
    const timeline = timelineOf();
    const previews = createPreviewSessions(world.deps);
    const opened = await previews.open(timeline.projectId, timeline.id);
    if (!opened.ok) throw new Error(opened.error.code);
    const dir = join(world.deps.folders.preview, tokenOf(opened.value.url));
    const mixesBefore = await readdir(join(dir, '.mix'));
    const removed = timeline.tracks[0]!.items[1]!.id;
    const shorter = {
      ...timeline,
      revision: timeline.revision + 1,
      tracks: [
        { ...timeline.tracks[0]!, items: [timeline.tracks[0]!.items[0]!] },
        ...timeline.tracks.slice(1),
      ],
    } as Timeline;
    world.timelines.set(timeline.id, shorter);
    const refreshed = await previews.refresh(opened.value.sessionId);
    if (!refreshed.ok) throw new Error(refreshed.error.code);
    expect(refreshed.value).toMatchObject({
      sessionId: opened.value.sessionId,
      revision: 1,
      durationFrames: 30,
    });
    expect(tokenOf(refreshed.value.url)).toBe(tokenOf(opened.value.url));
    expect(refreshed.value.url.endsWith('?rev=1')).toBe(true);
    expect(refreshed.value.compositionHash).not.toBe(opened.value.compositionHash);
    await expect(stat(join(dir, 'media', `${removed}.mp4`))).rejects.toThrow();
    const mixesAfter = await readdir(join(dir, '.mix'));
    expect(mixesAfter).toHaveLength(1);
    expect(mixesAfter).not.toEqual(mixesBefore);

    // The same timeline again: the mix is kept, not made again.
    const again = await previews.refresh(opened.value.sessionId);
    if (!again.ok) throw new Error(again.error.code);
    expect(await readdir(join(dir, '.mix'))).toEqual(mixesAfter);
    expect(again.value.compositionHash).toBe(refreshed.value.compositionHash);

    expect(await previews.close(opened.value.sessionId)).toEqual(ok({ closed: true }));
    await expect(stat(dir)).rejects.toThrow();
    expect(await previews.close(opened.value.sessionId)).toEqual(ok({ closed: false }));
    const expired = await previews.refresh(opened.value.sessionId);
    expect(!expired.ok && expired.error.code).toBe('render.preview_session_expired');
  });

  it('sweeps idle sessions, media folders and an earlier process’s folders', async () => {
    const timeline = timelineOf();
    const previews = createPreviewSessions(world.deps, { audio: false });
    const opened = await previews.open(timeline.projectId, timeline.id);
    if (!opened.ok) throw new Error(opened.error.code);
    const poster = await previews.mediaFolder('render-1:poster');
    expect(await previews.mediaFolder('render-1:poster')).toBe(poster);
    expect((await previews.mediaFolder('render-1:video')).token).not.toBe(poster.token);
    expect(poster.url('poster.jpg')).toBe(`app://preview/${poster.token}/poster.jpg`);
    const leftover = join(world.deps.folders.preview, 'ab'.repeat(16));
    const keep = join(world.deps.folders.preview, 'not-a-token');
    await mkdir(leftover);
    await mkdir(keep);
    const old = new Date(world.clock.now() - PREVIEW_IDLE_MS - 1000);
    await utimes(leftover, old, old);
    world.clock.advance(PREVIEW_IDLE_MS + 1);
    expect(await previews.sweep()).toBe(4);
    const left = await readdir(world.deps.folders.preview);
    expect(left).toContain('not-a-token');
    expect(left).not.toContain('ab'.repeat(16));
    expect(left).not.toContain(tokenOf(opened.value.url));
    const expired = await previews.refresh(opened.value.sessionId);
    expect(!expired.ok && expired.error.code).toBe('render.preview_session_expired');
  });

  it('refuses another project’s timeline and offline media without leaving a folder', async () => {
    const previews = createPreviewSessions(world.deps, { audio: false });
    const timeline = timelineOf();
    const before = await readdir(world.deps.folders.preview);
    const other = await previews.open(newId<'Project'>(), timeline.id);
    expect(!other.ok && other.error.code).toBe('core.not_found');
    const offline = timelineOf({ items: [{ frames: 30, assetId: newId<'Asset'>(), sourceStart: 0 }] });
    const missing = await previews.open(offline.projectId, offline.id);
    expect(!missing.ok && missing.error.code).toBe('render.media_missing');
    expect(await readdir(world.deps.folders.preview)).toEqual(before);
  });

  it('plays the reel’s own music from the kept reel, with no acknowledgement, and drops it once the reel is gone', async () => {
    // The kept reel as fetched: video and sound in one mp4, read straight from the template's media folder.
    const reel = join(work.dir, 'reference.mp4');
    await colourClip(ctx, reel, { colour: 'black', frames: 60, rate: '30', size: '64x64' });
    const templateId = newId<'Template'>();
    const timeline = timelineOf({
      items: [{ frames: 30, assetId: red, sourceStart: 0, mediaFrames: 60, muted: true }],
      music: { path: 'referenceAudio', templateId, gainDb: 0 },
    });
    world.reels.set(templateId, { media: reelMedia(), path: reel });
    const previews = createPreviewSessions(world.deps);
    const htmlOf = (url: string) =>
      readFile(join(world.deps.folders.preview, tokenOf(url), 'index.html'), 'utf8');
    const playing = await previews.open(timeline.projectId, timeline.id);
    if (!playing.ok) throw new Error(playing.error.code);
    expect(await htmlOf(playing.value.url)).toContain('<audio id="tc-mix"');
    // Deleted with its template, or never fetched: the preview still opens, without the music.
    world.reels.delete(templateId);
    const without = await previews.refresh(playing.value.sessionId);
    if (!without.ok) throw new Error(without.error.code);
    expect(await htmlOf(without.value.url)).not.toContain('tc-mix');
    await previews.closeAll();
  });
});
