// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Content Credentials through the export (P3-V7, SPEC P3.3 and P3.16). Off: Taalcut adds nothing (no C2PA
 * `uuid` box in the delivered bytes, not even when a source carried one, and the sidecar is never asked), and
 * the export dialog is told how many sources' credentials won't be kept. On: the finished file is signed after
 * `finishing` (here by a stand-in signer that appends a manifest box), QA reads the signed bytes, and the render
 * row records the credentials. The real sidecar's signing is sign.int.test.ts.
 */
import { appendFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FrameRate, newId, ok, type AssetId, type Timeline } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { C2PA_UUID, hasC2paManifestBox, topLevelBoxes } from '../../src/credentials/c2pa-box';
import type { RenderContentCredentials } from '../../src/credentials/content-credentials';
import type { C2paReadSummary, C2paSignRequest } from '../../src/credentials/sidecar';
import { exportCredentials } from '../../src/router/export-credentials';
import { movingClip, testEngine, type TestEngine } from '../support/engine';
import { findTestMedia, mediaContext, probeJson, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { makeTimeline } from '../support/timeline';
import { checkStatus, exportToEnd, failing, queueRender } from '../support/export-record';

const media = await findTestMedia('content credentials');
const shell = findTestShell('content credentials');
const skip = !media.binaries || !shell.path;
const RATE = FrameRate.of(30);

/** A top-level C2PA `uuid` box (its manifest store is a stand-in): what a signer leaves in an MP4. */
function manifestBox(): Buffer {
  const payload = Buffer.from('jumb stand-in manifest store');
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + C2PA_UUID.length + payload.length, 0);
  header.write('uuid', 4, 'latin1');
  return Buffer.concat([header, C2PA_UUID, payload]);
}

/** What the sidecar reads from a file Taalcut signed with the test certificate (nothing AI in it). */
const SIGNED: C2paReadSummary = {
  state: 'valid',
  generator: 'Taalcut',
  issuer: 'C2PA Test Signing Cert',
  digitalSourceTypes: [],
  actions: ['c2pa.opened', 'c2pa.transcoded'],
  actionsV2: true,
  ingredients: 1,
  ingredientDetails: [{ relationship: 'parentOf', hasManifest: true }],
  failures: ['signingCredential.untrusted'],
};

interface SpyCredentials extends RenderContentCredentials {
  readonly calls: string[];
  /** Each signing request with the streams its input had when it arrived. */
  readonly signed: { readonly request: C2paSignRequest; readonly streams: string[] }[];
}

/** A stand-in for the sidecar's client: counts every call; signing copies the file and appends a box. */
function spyCredentials(ctx: MediaContext): SpyCredentials {
  const calls: string[] = [];
  const signed: SpyCredentials['signed'] = [];
  return {
    calls,
    signed,
    async read(path) {
      calls.push('read');
      return ok({ presence: (await hasC2paManifestBox(path)) ? 'present' : 'absent', summary: null });
    },
    async inspect(path) {
      calls.push('inspect');
      return ok((await hasC2paManifestBox(path)) ? SIGNED : { ...SIGNED, state: 'absent' });
    },
    async sign(request) {
      calls.push('sign');
      const probe = (await probeJson(ctx, request.input, 'stream=codec_type')) as {
        streams: { codec_type: string }[];
      };
      signed.push({ request, streams: probe.streams.map((stream) => stream.codec_type) });
      await copyFile(request.input, request.output);
      await appendFile(request.output, manifestBox());
      return ok({ state: 'valid', failures: [], summary: SIGNED });
    },
  };
}

describe.skipIf(skip)('Content Credentials in the export (P3-V7)', { timeout: 600_000 }, () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  const signedSource = newId<'Asset'>();
  const plainSource = newId<'Asset'>();

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('credentials');
    await movingClip(ctx, join(work.dir, 'plain.mp4'), { frames: 120, rate: '30' });
    // A provider's file: the same picture with a manifest box of its own.
    await copyFile(join(work.dir, 'plain.mp4'), join(work.dir, 'signed.mp4'));
    await appendFile(join(work.dir, 'signed.mp4'), manifestBox());
  });
  afterAll(() => work?.dispose());

  function engineWith(name: string, credentials: SpyCredentials): TestEngine {
    const engine = testEngine(join(work.dir, name), ctx, shell.path!, { credentials });
    engine.assets.set(signedSource, join(work.dir, 'signed.mp4'));
    engine.assets.set(plainSource, join(work.dir, 'plain.mp4'));
    return engine;
  }

  const timelineOf = (assets: readonly AssetId[]): Timeline =>
    makeTimeline({
      rate: RATE,
      items: assets.map((assetId) => ({
        frames: 45,
        assetId,
        sourceStart: 0,
        mediaFrames: 120,
        mediaRate: RATE,
      })),
    });

  it('adds nothing when off: no manifest box, no sidecar call, and the dialog says sources are not kept', async () => {
    expect(await hasC2paManifestBox(join(work.dir, 'signed.mp4'))).toBe(true);
    const credentials = spyCredentials(ctx);
    const engine = engineWith('off', credentials);
    const timeline = timelineOf([signedSource, plainSource]);

    // The export dialog's note: one of the two sources carries credentials, the option is off.
    const note = await exportCredentials({ assets: engine.deps.assets }, timeline.projectId, timeline);
    expect(note).toEqual({ add: false, sourcesWithCredentials: 1, disclosures: [] });

    const stored = await exportToEnd(engine, await queueRender(engine, timeline));
    expect(failing(stored)).toEqual([]);
    expect(stored.status).toBe('ready');
    expect(checkStatus(stored, 'contentCredentials')).toBe('pass');
    const boxes = await topLevelBoxes(stored.filePath!);
    expect(boxes.map((box) => box.type)).not.toContain('uuid');
    expect(await hasC2paManifestBox(stored.filePath!)).toBe(false);
    expect(credentials.calls).toEqual([]);
    expect(stored.credentials).toEqual({ added: false, state: null });
    expect(engine.store.updates.some((update) => update.patch.credentials !== undefined)).toBe(false);
  });

  it('signs the finished file when on, checks the signed bytes and records the credentials', async () => {
    const credentials = spyCredentials(ctx);
    const engine = engineWith('on', credentials);
    const timeline = timelineOf([signedSource, plainSource]);
    const stored = await exportToEnd(
      engine,
      await queueRender(engine, timeline, { contentCredentials: true }),
    );
    expect(failing(stored)).toEqual([]);
    expect(stored.status).toBe('ready');
    expect(checkStatus(stored, 'contentCredentials')).toBe('pass');
    expect(await hasC2paManifestBox(stored.filePath!)).toBe(true);
    // Signed once, after finishing: the file it got already had its picture and its sound.
    expect(credentials.signed).toHaveLength(1);
    const [first] = credentials.signed;
    expect(first?.streams).toEqual(['video', 'audio']);
    // The provider's manifest travels as an ingredient, titled generically (never a file name).
    expect(
      first?.request.ingredients.map((ingredient) => [ingredient.title, ingredient.relationship]),
    ).toEqual([['clip 1', 'componentOf']]);
    expect(JSON.stringify(first?.request.manifest)).not.toContain('signed.mp4');
    // QA read the delivered (signed) file.
    expect(credentials.calls.filter((call) => call === 'inspect').length).toBeGreaterThan(0);
    expect(stored.credentials).toEqual({ added: true, state: 'valid' });
  });
});
