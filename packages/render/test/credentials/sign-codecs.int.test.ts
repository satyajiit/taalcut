// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-AV1: Content Credentials on the newer codecs. The real `taalcut-c2pa` sidecar signs a 2 s AV1 export (`av01`,
 * on the machine's hardware AV1 encoder, else SVT-AV1) and a 2 s HEVC export (`hvc1`, on its hardware HEVC encoder)
 * with AAC, made with the export flags; a validator reads each back `Valid` with the test issuer's
 * `signingCredential.untrusted` as its only failure, the box sits before `moov` and `mdat`, and the signed file still
 * probes as the same stream. A codec skips only when this machine and build have no encoder for it.
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { hardwareEncoders, runProcess, videoEncodeFlags, type MediaContext } from '@taalcut/media';
import { aiInventory } from '../../src/credentials/ai-inventory';
import { hasC2paManifestBox, topLevelBoxes } from '../../src/credentials/c2pa-box';
import {
  createContentCredentials,
  type RenderContentCredentials,
} from '../../src/credentials/content-credentials';
import { exportManifest } from '../../src/credentials/manifest';
import type { C2paSidecar } from '../../src/credentials/sidecar';
import { startC2paSidecar } from '../../src/credentials/sidecar-path';
import { ffmpeg, findTestMedia, mediaContext, probeJson, tempDir } from '../support/media';
import { partsTimeline } from './support';

let ctx: MediaContext;
let work: Awaited<ReturnType<typeof tempDir>>;
let sidecar: C2paSidecar;
let credentials: RenderContentCredentials;
/** The encoder each codec's export is made with here, when there is one. */
let encoders: { av1?: string; hevc?: string };
const file = (name: string) => join(work.dir, name);

const media = await findTestMedia('credentials on AV1 and HEVC');

beforeAll(async () => {
  if (!media.binaries) return;
  ctx = mediaContext(media.binaries);
  work = await tempDir('c2pa-codecs');
  const hardware = await hardwareEncoders(ctx);
  const listed = await runProcess(media.binaries.ffmpeg, ['-hide_banner', '-encoders']);
  const svt = listed.ok && / libsvtav1 /.test(listed.value.stdout.toString());
  const found = hardware.ok ? hardware.value : {};
  encoders = {
    ...((found.av1 ?? (svt ? 'libsvtav1' : undefined)) ? { av1: found.av1 ?? 'libsvtav1' } : {}),
    ...(found.hevc ? { hevc: found.hevc } : {}),
  };
  sidecar = startC2paSidecar(inject('c2paSidecar'), [work.dir]);
  credentials = createContentCredentials({ sidecar: async () => sidecar });
}, 120_000);

afterAll(async () => {
  await sidecar?.close();
  await work?.dispose();
});

/** A 2 s portrait export in `encoder`, with AAC, as the finish writes one (export flags, faststart). */
async function exportIn(encoder: string, name: string): Promise<string> {
  await ffmpeg(ctx, [
    ...['-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=30:d=2'],
    ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2'],
    ...['-vf', 'format=yuv420p'],
    ...videoEncodeFlags(encoder, 8_000_000, 30, { purpose: 'export' }),
    ...['-c:a', 'aac', '-b:a', '192k', '-shortest'],
    file(name),
  ]);
  return file(name);
}

const manifest = () => {
  const { timeline, provenanceOf } = partsTimeline({
    clips: [false, true],
    voice: [false],
    voiceoverLines: [0],
    music: 'ownTrack',
  });
  return exportManifest({
    title: 'Taalcut export',
    generatorVersion: '0.1.0',
    inventory: aiInventory(timeline, provenanceOf),
    singleClipNoEdits: false,
    signedSources: new Map(),
  });
};

describe.skipIf(!media.binaries).each([
  { codec: 'av1' as const, tag: 'av01' },
  { codec: 'hevc' as const, tag: 'hvc1' },
])('Content Credentials on $codec', ({ codec, tag }) => {
  it(`signs an ${tag} export a validator reads back as valid, untrusted test issuer only`, async (test) => {
    const encoder = encoders[codec];
    if (!encoder) return test.skip();
    const input = await exportIn(encoder, `${codec}.mp4`);
    const output = file(`${codec}-signed.mp4`);
    const made = manifest();
    const signed = await credentials.sign({
      input,
      output,
      manifest: made.definition,
      ingredients: made.ingredients,
    });
    expect(signed).toMatchObject({ ok: true, value: { state: 'valid', failures: [] } });
    const read = await credentials.inspect(output);
    expect(read.ok && read.value).toMatchObject({
      state: 'valid',
      failures: ['signingCredential.untrusted'],
      generator: 'Taalcut 0.1.0',
    });
    expect(await hasC2paManifestBox(output)).toBe(true);
    const boxes = (await topLevelBoxes(output)).map((box) => box.type);
    expect(boxes.indexOf('uuid')).toBeLessThan(Math.min(boxes.indexOf('moov'), boxes.indexOf('mdat')));
    // The stream is the one that went in: signing adds a box, never touches the samples.
    const facts = (await probeJson(ctx, output, 'stream=codec_name,codec_tag_string,profile')) as {
      streams: Record<string, unknown>[];
    };
    expect(facts.streams[0]).toMatchObject({ codec_name: codec, codec_tag_string: tag, profile: 'Main' });
    expect(facts.streams[1]).toMatchObject({ codec_name: 'aac' });
  });
});
