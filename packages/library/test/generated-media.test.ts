// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Generated media header inspection (`probeGeneratedMedia`) and fallback `ShotProfileSource.profiles` so media
 * imported from the sandbox (`workspace.importMedia`) can be placed onto a timeline immediately before background
 * indexing runs.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, unwrap } from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAssetRepository,
  createGeneratedAssetSink,
  createShotProfileSource,
  openDatabase,
  probeGeneratedMedia,
} from '../src/index';

function makePng(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(32);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buf.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(buf.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return buf;
}

function makeMp4(width: number, height: number, timescale: number, durationUnits: number): Uint8Array {
  // Minimal ftyp (16B) + moov containing mvhd v0 (32B) and trak->tkhd v0 (92B).
  const mvhd = new Uint8Array(32);
  const mvhdView = new DataView(mvhd.buffer);
  mvhdView.setUint32(0, 32, false);
  mvhd.set([0x6d, 0x76, 0x68, 0x64], 4); // 'mvhd'
  mvhdView.setUint32(8 + 12, timescale, false);
  mvhdView.setUint32(8 + 16, durationUnits, false);

  const tkhd = new Uint8Array(92);
  const tkhdView = new DataView(tkhd.buffer);
  tkhdView.setUint32(0, 92, false);
  tkhd.set([0x74, 0x6b, 0x68, 0x64], 4); // 'tkhd'
  tkhdView.setUint32(8 + 76, width * 65536, false);
  tkhdView.setUint32(8 + 80, height * 65536, false);

  const trak = new Uint8Array(8 + tkhd.byteLength);
  new DataView(trak.buffer).setUint32(0, trak.byteLength, false);
  trak.set([0x74, 0x72, 0x61, 0x6b], 4); // 'trak'
  trak.set(tkhd, 8);

  const moov = new Uint8Array(8 + mvhd.byteLength + trak.byteLength);
  new DataView(moov.buffer).setUint32(0, moov.byteLength, false);
  moov.set([0x6d, 0x6f, 0x6f, 0x76], 4); // 'moov'
  moov.set(mvhd, 8);
  moov.set(trak, 8 + mvhd.byteLength);
  return moov;
}

let tempDir: string | undefined;
afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('probeGeneratedMedia & unindexed ShotProfileSource', () => {
  it('inspects PNG and MP4 headers for dimensions, orientation and duration', () => {
    const png = probeGeneratedMedia(makePng(1080, 1920), 'image/png');
    expect(png).toEqual({
      width: 1080,
      height: 1920,
      orientation: 'portrait',
      duration: null,
    });

    const mp4 = probeGeneratedMedia(makeMp4(1080, 1920, 1000, 4000), 'video/mp4');
    expect(mp4).toEqual({
      width: 1080,
      height: 1920,
      orientation: 'portrait',
      duration: { value: 120, rate: { num: 30, den: 1 } },
    });
  });

  it('persists probed dimensions and duration in GeneratedAssetSink and synthesizes fallback shot profiles', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'taalcut-gen-media-'));
    const db = unwrap(openDatabase({ path: ':memory:' }));
    const sink = createGeneratedAssetSink(db, { originalsRoot: tempDir });
    const projectId = newId<'Project'>();

    const keptVideo = unwrap(
      await sink.put({
        bytes: makeMp4(1080, 1920, 1000, 5000),
        mediaType: 'video/mp4',
        fileName: 'hyperframes-scene.mp4',
        provenance: {
          kind: 'generated',
          generation: 'workspace',
          provider: 'taalcut',
          model: 'workspace',
          access: 'local',
          quality: null,
          promptSha256: '0'.repeat(64),
          voiceId: null,
          providerRef: null,
          c2pa: 'unknown',
          costUsd: 0,
          runId: null,
          createdAt: Date.now(),
        },
        projectId,
      }),
    );

    const asset = unwrap(createAssetRepository(db).get(keptVideo.assetId));
    expect(asset.width).toBe(1080);
    expect(asset.height).toBe(1920);
    expect(asset.orientation).toBe('portrait');
    expect(asset.durationValue).toBe(150);
    expect(asset.durationRateNum).toBe(30);
    expect(asset.durationRateDen).toBe(1);

    const source = createShotProfileSource({ db });
    const profiles = unwrap(await source.profiles([{ assetId: keptVideo.assetId, shotId: null }]));
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      assetId: keptVideo.assetId,
      shotId: null,
      kind: 'video',
      orientation: 'portrait',
      range: {
        start: { value: 0, rate: { num: 30, den: 1 } },
        duration: { value: 150, rate: { num: 30, den: 1 } },
      },
    });
    db.close();
  });
});
