// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * REF1: path d's source in the render process. The reel comes from core's TemplateMediaStore once a root registers
 * it, and is nothing before that; a silent reel or a file that is gone is nothing too. With the library's own store,
 * registered as the render root does it, a reel kept for a template is found in its media folder. The reel's link
 * and sound credit come from the template version in the library.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createContainer,
  FrameRate,
  ok,
  RationalTime,
  TemplateMediaStoreToken,
  unwrap,
  type Template,
  type TemplateMedia,
  type TemplateMediaStore,
} from '@taalcut/core';
import { createTemplateStore, openDatabase } from '@taalcut/library';
import { syntheticTemplate } from '@taalcut/templates';
import { LibraryDatabaseToken } from '../src/shared/tokens';
import { registerTemplateMedia } from '../src/utility/roots/agent-template-media';
import { renderReferenceAudio } from '../src/utility/roots/render-reference';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const LINK = 'https://www.instagram.com/reel/EXAMPLE123/';
const rate = FrameRate.of(30);

const media = (hasAudio: boolean): TemplateMedia => ({
  file: 'reference.mp4',
  bytes: 17,
  durationMs: 2000,
  sha256: 'a'.repeat(64),
  hasAudio,
  source: 'anonymous',
  keptAt: 1,
});

/** A template made from a pasted reel, with the sound the platform credited. */
function fromReel(): Template {
  const base = syntheticTemplate({ index: 1, shots: [30, 30] });
  return {
    ...base,
    origin: {
      kind: 'reference',
      input: 'link',
      platform: 'reels',
      url: LINK,
      fingerprint: 'b'.repeat(64),
      source: { duration: RationalTime.of(60, rate), rate, width: 1080, height: 1920 },
      crop: null,
      pipelineVersion: '1',
      configVersion: '1',
      analysedAt: 1,
    },
    audio: { ...base.audio, sound: { title: 'Golden Hour', artist: 'Someone' } },
  };
}

async function world() {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-render-reference-'));
  dirs.push(dir);
  const db = unwrap(openDatabase({ path: ':memory:' }));
  const template = fromReel();
  unwrap(
    await createTemplateStore(db, { assetsDir: join(dir, 'templates', 'assets') }).create(template, {
      name: 'From a reel',
      projectId: null,
      listed: true,
    }),
  );
  const reel = join(dir, 'reference.mp4');
  writeFileSync(reel, 'a film and its music');
  const container = createContainer().value(LibraryDatabaseToken, db);
  return { dir, template, reel, container };
}

describe('render reference audio', () => {
  it('is no reel before a template media store is registered, and the kept reel after', async () => {
    const { dir, template, reel, container } = await world();
    const source = renderReferenceAudio(container, { userData: dir }).referenceAudio!;
    expect(await source.file(template.id)).toEqual(ok(null));
    const kept = new Map([[template.id, { media: media(true), path: reel }]]);
    const store: Pick<TemplateMediaStore, 'get'> = { get: async (id) => ok(kept.get(id) ?? null) };
    container.value(TemplateMediaStoreToken, store as TemplateMediaStore);
    expect(await source.file(template.id)).toEqual(ok(reel));
    kept.set(template.id, { media: media(false), path: reel });
    expect(await source.file(template.id)).toEqual(ok(null));
    kept.set(template.id, { media: media(true), path: join(dir, 'gone.mp4') });
    expect(await source.file(template.id)).toEqual(ok(null));
  });

  it('finds a reel kept by the library’s store, registered as the render root does it', async () => {
    const { dir, template, reel, container } = await world();
    registerTemplateMedia(container, { userData: dir });
    const source = renderReferenceAudio(container, { userData: dir }).referenceAudio!;
    expect(await source.file(template.id)).toEqual(ok(null));
    const kept = await container.resolve(TemplateMediaStoreToken).keep(template.id, {
      path: reel,
      mode: 'copy',
      durationMs: 2000,
      hasAudio: true,
      source: 'file',
    });
    expect(kept.ok).toBe(true);
    expect(await source.file(template.id)).toEqual(
      ok(join(dir, 'templates', 'media', template.id, 'reference.mp4')),
    );
  });

  it('reads the reel’s link and sound credit from the template version in the library', async () => {
    const { dir, template, container } = await world();
    const source = renderReferenceAudio(container, { userData: dir }).referenceAudio!;
    expect(await source.credit!({ id: template.id, version: 1 })).toEqual(
      ok({ referenceUrl: LINK, soundLabel: 'Golden Hour · Someone' }),
    );
    const missing = await source.credit!({ id: template.id, version: 9 });
    expect(missing.ok).toBe(false);
  });
});
