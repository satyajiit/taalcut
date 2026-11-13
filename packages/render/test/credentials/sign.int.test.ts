// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The real `taalcut-c2pa` sidecar (built by the project's global setup, build-sidecar.ts, when the crate changed)
 * on a 2 s H.264 + AAC export made with the bundled FFmpeg: a validator reads the manifest back `Valid` with the
 * test issuer's `signingCredential.untrusted` as its only failure; a provider's own manifest travels as a
 * `componentOf` ingredient; a remux drops the box and signing again works. Never skips: no cargo or no FFmpeg
 * fails.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { MediaContext } from '@taalcut/media';
import { aiInventory } from '../../src/credentials/ai-inventory';
import { hasC2paManifestBox, topLevelBoxes } from '../../src/credentials/c2pa-box';
import {
  createContentCredentials,
  type RenderContentCredentials,
} from '../../src/credentials/content-credentials';
import { DIGITAL_SOURCE_TYPES, exportManifest } from '../../src/credentials/manifest';
import type { C2paSidecar } from '../../src/credentials/sidecar';
import { startC2paSidecar } from '../../src/credentials/sidecar-path';
import { contentCredentialsCheck } from '../../src/qa/checks/credentials';
import { ffmpeg, findTestMedia, mediaContext, tempDir } from '../support/media';
import { partsTimeline } from './support';
import { FIXTURE_H264 } from '../support/host-video';

/** The checkout's root: a folder the sidecar is not allowed to write in. */
const REPO = join(import.meta.dirname, '..', '..', '..', '..');

let ctx: MediaContext;
let work: Awaited<ReturnType<typeof tempDir>>;
let sidecar: C2paSidecar;
let credentials: RenderContentCredentials;
const file = (name: string) => join(work.dir, name);

const provider = {
  title: 'provider render',
  claim_generator_info: [{ name: 'Example Provider', version: '2.0' }],
  ingredients: [],
  assertions: [
    {
      label: 'c2pa.actions.v2',
      data: {
        actions: [
          { action: 'c2pa.created', digitalSourceType: DIGITAL_SOURCE_TYPES.trainedAlgorithmicMedia },
        ],
      },
    },
  ],
};

const media = await findTestMedia('credentials sign');

beforeAll(async () => {
  if (!media.binaries) return;
  ctx = mediaContext(media.binaries);
  const binary = inject('c2paSidecar');
  work = await tempDir('c2pa');
  await ffmpeg(ctx, [
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x568:r=30:d=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-c:v',
    FIXTURE_H264,
    '-b:v',
    '1M',
    '-c:a',
    'aac',
    '-shortest',
    '-movflags',
    '+faststart',
    file('export.mp4'),
  ]);
  sidecar = startC2paSidecar(binary, [work.dir]);
  credentials = createContentCredentials({ sidecar: async () => sidecar });
  // A provider's own Content Credentials on a source (what models and audio read at ingest).
  const signed = await sidecar.sign({
    input: file('export.mp4'),
    output: file('provider.mp4'),
    manifest: provider,
    ingredients: [],
  });
  if (!signed.ok) throw new Error(`provider fixture: ${signed.error.code}`);
});

afterAll(async () => {
  await sidecar?.close();
  await work?.dispose();
});

const mixed = () => {
  const { timeline, provenanceOf } = partsTimeline({
    clips: [false, true],
    voice: [false],
    voiceoverLines: [0],
    music: 'ownTrack',
  });
  return aiInventory(timeline, provenanceOf);
};

describe.skipIf(!media.binaries)('c2pa sidecar', () => {
  it('reads an unsigned export as absent and finds no box in it', async () => {
    expect(await credentials.read(file('export.mp4'))).toEqual({
      ok: true,
      value: { presence: 'absent', summary: null },
    });
    expect(await hasC2paManifestBox(file('export.mp4'))).toBe(false);
  });

  it('signs an export that a validator reads back as valid, untrusted test issuer only', async () => {
    const inventory = mixed();
    const manifest = exportManifest({
      title: 'Taalcut export',
      generatorVersion: '0.1.0',
      inventory,
      singleClipNoEdits: false,
      signedSources: new Map(),
    });
    const signed = await credentials.sign({
      input: file('export.mp4'),
      output: file('signed.mp4'),
      manifest: manifest.definition,
      ingredients: manifest.ingredients,
    });
    expect(signed).toMatchObject({ ok: true, value: { state: 'valid', failures: [] } });
    const read = await credentials.inspect(file('signed.mp4'));
    if (!read.ok || !read.value) throw new Error('no read');
    expect(read.value).toMatchObject({
      state: 'valid',
      failures: ['signingCredential.untrusted'],
      actionsV2: true,
      issuer: 'C2PA Test Signing Cert',
      generator: 'Taalcut 0.1.0',
      actions: ['c2pa.created', 'c2pa.placed', 'c2pa.placed'],
      ingredients: 2,
    });
    expect(read.value.digitalSourceTypes).toEqual([
      DIGITAL_SOURCE_TYPES.compositeSynthetic,
      DIGITAL_SOURCE_TYPES.compositeWithTrainedAlgorithmicMedia,
    ]);
    const boxes = (await topLevelBoxes(file('signed.mp4'))).map((box) => box.type);
    expect(boxes[0]).toBe('ftyp');
    expect(boxes.indexOf('uuid')).toBeLessThan(Math.min(boxes.indexOf('moov'), boxes.indexOf('mdat')));
    const boxPresent = await hasC2paManifestBox(file('signed.mp4'));
    expect(contentCredentialsCheck({ add: true, boxPresent, read: read.value, inventory }).status).toBe(
      'pass',
    );
    // Nothing the person named, and no path, is in the file's manifest.
    expect((await readFile(file('signed.mp4'))).includes(Buffer.from(work.dir))).toBe(false);
  });

  it("carries a provider's own manifest as a componentOf ingredient", async () => {
    const inventory = mixed();
    const providerClip = inventory.parts.find((part) => part.title === 'clip 2');
    if (!providerClip) throw new Error('no clip 2');
    const manifest = exportManifest({
      title: 'Taalcut export',
      generatorVersion: '0.1.0',
      inventory,
      singleClipNoEdits: false,
      signedSources: new Map([[providerClip.id, file('provider.mp4')]]),
    });
    const signed = await credentials.sign({
      input: file('export.mp4'),
      output: file('with-provider.mp4'),
      manifest: manifest.definition,
      ingredients: manifest.ingredients,
    });
    expect(signed).toMatchObject({ ok: true, value: { state: 'valid' } });
    // The provider's store came along (definition ingredients are listed before file ones).
    const details = signed.ok ? signed.value.summary.ingredientDetails : [];
    expect(details).toHaveLength(2);
    expect(details).toEqual(
      expect.arrayContaining([
        { relationship: 'componentOf', hasManifest: true },
        { relationship: 'componentOf', hasManifest: false },
      ]),
    );
  });

  it('loses the box on a remux (FFmpeg keeps no uuid box) and signs again', async () => {
    await ffmpeg(ctx, [
      '-i',
      file('signed.mp4'),
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      file('remuxed.mp4'),
    ]);
    expect(await hasC2paManifestBox(file('remuxed.mp4'))).toBe(false);
    expect(await credentials.read(file('remuxed.mp4'))).toEqual({
      ok: true,
      value: { presence: 'absent', summary: null },
    });
    const inventory = mixed();
    const manifest = exportManifest({
      title: 'Taalcut export',
      generatorVersion: '0.1.0',
      inventory,
      singleClipNoEdits: false,
      signedSources: new Map(),
    });
    const again = await credentials.sign({
      input: file('remuxed.mp4'),
      output: file('resigned.mp4'),
      manifest: manifest.definition,
      ingredients: [],
    });
    expect(again).toMatchObject({ ok: true, value: { state: 'valid' } });
    expect(await hasC2paManifestBox(file('resigned.mp4'))).toBe(true);
  });

  it('refuses a path outside the folders it was given', async () => {
    const outside = await credentials.sign({
      input: file('export.mp4'),
      output: join(REPO, 'escaped.mp4'),
      manifest: provider,
      ingredients: [],
    });
    expect(outside.ok ? null : outside.error.code).toBe('render.credentials_unavailable');
    expect(outside.ok ? '' : (outside.error.detail ?? '')).toContain('media.sidecar_rejected');
  });
});

describe.skipIf(!media.binaries)('reading bytes in memory (contract round P3-3)', () => {
  it("reads a provider's signed still as present and a plain one as absent, and leaves nothing staged", async () => {
    await ffmpeg(ctx, ['-f', 'lavfi', '-i', 'testsrc2=s=64x64', '-frames:v', '1', file('still.png')]);
    const signed = await sidecar.sign({
      input: file('still.png'),
      output: file('still-signed.png'),
      manifest: provider,
      ingredients: [],
    });
    if (!signed.ok) throw new Error(`signed still: ${signed.error.code} ${signed.error.detail ?? ''}`);
    // Staged inside the folder the sidecar was started with.
    const staging = file('staged');
    const fromBytes = createContentCredentials({ sidecar: async () => sidecar, stagingDir: staging });
    if (!fromBytes.readBytes) throw new Error('readBytes needs a staging folder');
    expect(await fromBytes.readBytes(await readFile(file('still-signed.png')), 'image/png')).toMatchObject({
      ok: true,
      value: {
        presence: 'present',
        summary: { digitalSourceTypes: [DIGITAL_SOURCE_TYPES.trainedAlgorithmicMedia] },
      },
    });
    expect(await fromBytes.readBytes(await readFile(file('still.png')), 'image/png')).toEqual({
      ok: true,
      value: { presence: 'absent', summary: null },
    });
    expect(await readdir(staging)).toEqual([]);
  });
});
