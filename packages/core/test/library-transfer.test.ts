// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Phase 2's library and Wi-Fi import contract: views, index stages, namespaces, commands, transfer, events. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  assetSummarySchema,
  createEventBus,
  createManualClock,
  defineIndexStage,
  defineJobKind,
  indexingContract,
  libraryCommandPayloads,
  LIBRARY_COMMANDS,
  libraryContract,
  newId,
  ok,
  PROJECT_COMMANDS,
  projectCommandPayloads,
  projectsContract,
  reencodeCheckSchema,
  searchHitSchema,
  stagedImportSchema,
  stageJob,
  taalcutEventSchema,
  transferApprovalSchema,
  transferContract,
  transferFileSchema,
  transferPairingSchema,
  transferSessionSchema,
  transferStreamItemSchema,
  type IndexStageDefinition,
  type IndexingStatus,
  type TransferSession,
} from '@taalcut/core';

const T = 1_760_000_000_000;
const sourceId = newId<'Source'>();
const assetId = newId<'Asset'>();
const fps30 = { num: 30, den: 1 };

/** Runs a contract procedure's input schema, as the server does before a handler. */
function input(procedure: { '~orpc': { inputSchema?: unknown } }, value: unknown) {
  const schema = procedure['~orpc'].inputSchema as z.ZodType;
  return schema.safeParse(value);
}

const asset = {
  id: assetId,
  kind: 'video',
  name: 'IMG_0418.MOV',
  capturedAt: T,
  addedAt: T + 1,
  duration: { value: 1260, rate: fps30 },
  width: 1080,
  height: 1920,
  orientation: 'portrait',
  availability: 'online',
  sourceIds: [sourceId],
  description: 'A wave breaking at sunset',
  quality: 0.82,
  shotCount: 3,
  language: 'en',
  index: { state: 'indexing', done: 4, total: 9 },
  thumbnail: null,
  reencode: null,
  trashed: false,
  provenance: { kind: 'captured' },
};

describe('library views', () => {
  it('parses an asset and a search hit, and needs a reason for every hit', () => {
    expect(assetSummarySchema.parse(asset)).toMatchObject({ id: assetId, kind: 'video' });
    const shot = {
      id: newId<'Shot'>(),
      assetId,
      index: 0,
      range: { start: { value: 0, rate: fps30 }, duration: { value: 90, rate: fps30 } },
      description: null,
      shotType: 'wide',
      motion: null,
      quality: null,
      bestTake: true,
      thumbnail: null,
    };
    const hit = { shot, asset, score: 1, matchedBy: ['visual', 'speech'] };
    expect(searchHitSchema.parse(hit).matchedBy).toEqual(['visual', 'speech']);
    expect(searchHitSchema.safeParse({ ...hit, matchedBy: [] }).success).toBe(false);
    expect(reencodeCheckSchema.safeParse({ verdict: 'likely', reasons: Array(9).fill('hevc') }).success).toBe(
      false,
    );
  });

  it('applies the browse, search and transcript defaults', () => {
    expect(input(libraryContract.browse, {}).data).toEqual({
      sort: 'captured',
      direction: 'desc',
      limit: 60,
    });
    expect(input(libraryContract.search, { query: '  sunset  ' }).data).toEqual({
      query: 'sunset',
      limit: 30,
    });
    expect(input(libraryContract.search, { query: '   ' }).success).toBe(false);
    expect(input(libraryContract.transcript, { assetId }).data).toEqual({
      assetId,
      fromSegment: 0,
      limit: 500,
    });
    expect(input(indexingContract.prioritise, { assetIds: [] }).success).toBe(false);
  });
});

describe('index stages', () => {
  const kind = defineJobKind({
    kind: 'vision.shots',
    input: z.object({ path: z.string() }),
    output: z.object({ cuts: z.array(z.number()) }),
    resource: 'gpu',
  });
  const stage: IndexStageDefinition = {
    stage: 'vision.shots',
    version: 1,
    needs: ['media.normalise'],
    appliesTo: ['video'],
    priority: 'normal',
    job: (view) => stageJob(kind, { path: view.path }),
    result: () => ok({}),
  };

  it('defines a stage and builds its job', () => {
    expect(defineIndexStage(stage)).toBe(stage);
    expect(stageJob(kind, { path: '/a.mov' })).toEqual({ kind, input: { path: '/a.mov' } });
    expect(stageJob(kind, { path: '/a.mov' }, 'high')).toMatchObject({ priority: 'high' });
  });

  it('throws on a bad name, version, need or kind', () => {
    expect(() => defineIndexStage({ ...stage, stage: 'Shots' })).toThrow(/Invalid index stage/);
    expect(() => defineIndexStage({ ...stage, version: 0 })).toThrow(/positive integer version/);
    expect(() => defineIndexStage({ ...stage, needs: ['vision.shots'] })).toThrow(/invalid stage/);
    expect(() => defineIndexStage({ ...stage, appliesTo: ['film' as never] })).toThrow(/asset kind/);
    expect(() => defineIndexStage({ ...stage, appliesTo: [] })).toThrow(/asset kind/);
  });
});

describe('library and project commands', () => {
  it('watches a new folder by default and checks relinks', () => {
    const add = libraryCommandPayloads[LIBRARY_COMMANDS.addSource];
    expect(add.parse({ path: '~/Movies/Trip' })).toEqual({ path: '~/Movies/Trip', watch: true });
    const relink = libraryCommandPayloads[LIBRARY_COMMANDS.relinkLocations];
    const item = { locationId: newId<'AssetLocation'>(), path: '/Volumes/SSD/Trip/a.mov' };
    expect(relink.safeParse({ items: [{ ...item, contentHash: 'f'.repeat(64) }] }).success).toBe(true);
    expect(relink.safeParse({ items: [{ ...item, contentHash: 'XYZ' }] }).success).toBe(false);
    const reindex = libraryCommandPayloads[LIBRARY_COMMANDS.reindexAssets];
    expect(reindex.safeParse({ assetIds: [assetId], stages: ['Vision'] }).success).toBe(false);
  });

  it('saves and restores timeline versions, and lists projects', () => {
    const projectId = newId<'Project'>();
    const timelineId = newId<'Timeline'>();
    const save = projectCommandPayloads[PROJECT_COMMANDS.saveVersion];
    expect(save.parse({ projectId, timelineId, label: ' Before music ' }).label).toBe('Before music');
    const restore = projectCommandPayloads[PROJECT_COMMANDS.restoreVersion];
    expect(restore.safeParse({ projectId, timelineId, versionId: newId<'TimelineVersion'>() }).success).toBe(
      true,
    );
    expect(input(projectsContract.list, {}).data).toEqual({ archived: false, limit: 50 });
  });
});

const session: TransferSession = {
  id: newId<'TransferSession'>(),
  state: 'listening',
  url: 'http://192.168.1.20:8421',
  network: { interface: 'en0', address: '192.168.1.20', reachable: 'yes' },
  pairingResets: 0,
  devices: [],
  totals: { files: 1, done: 0, failed: 0, bytes: 1000, bytesDone: 500 },
  startedAt: T,
};

describe('transfer', () => {
  it('keeps pairing secrets out of the session', () => {
    const pairing = { qrText: `${session.url}#k=abc`, code: '7K3M9PQX', pin: '042917' };
    expect(transferPairingSchema.parse(pairing)).toEqual(pairing);
    for (const code of ['7K3M9PQI', '7k3m9pqx', '7K3M9PQ'])
      expect(transferPairingSchema.safeParse({ ...pairing, code }).success).toBe(false);
    expect(transferPairingSchema.safeParse({ ...pairing, pin: '42917' }).success).toBe(false);
    expect(transferSessionSchema.parse({ ...session, ...pairing })).toEqual(session);
    const first = transferStreamItemSchema.parse({ type: 'session', session, pairing });
    expect(first).toMatchObject({ type: 'session', pairing });
    expect(input(transferContract.close, { sessionId: 'x' }).success).toBe(false);
  });

  it('streams a phone asking to pair to the opening window, and takes a yes or no for it (UX3)', () => {
    const approval = {
      id: newId<'TransferApproval'>(),
      sessionId: session.id,
      state: 'pending',
      device: { label: 'iPhone', platform: 'ios' },
      address: '192.168.1.31',
      matchCode: '47',
      requestedAt: T,
      expiresAt: T + 60_000,
    };
    expect(transferStreamItemSchema.parse({ type: 'approval', approval })).toEqual({
      type: 'approval',
      approval,
    });
    for (const matchCode of ['4', '470', 'ab'])
      expect(transferApprovalSchema.safeParse({ ...approval, matchCode }).success).toBe(false);
    expect(transferApprovalSchema.safeParse({ ...approval, state: 'maybe' }).success).toBe(false);
    const answer = { sessionId: session.id, approvalId: approval.id, allow: true };
    expect(input(transferContract.answerApproval, answer).success).toBe(true);
    expect(input(transferContract.answerApproval, { ...answer, allow: 'yes' }).success).toBe(false);
    expect(input(transferContract.answerApproval, { ...answer, approvalId: 'x' }).success).toBe(false);
  });

  it('stages an upload for the library', () => {
    const staged = {
      sessionId: session.id,
      uploadId: newId<'TransferUpload'>(),
      path: '/Volumes/SSD/.taalcut-staging/u1',
      companions: ['/Volumes/SSD/.taalcut-staging/u1.info'],
      fileName: 'IMG_0418.MOV',
      sizeBytes: 1000,
      mimeType: 'video/quicktime',
      lastModified: T,
      device: { id: newId<'TransferDevice'>(), label: 'iPhone', platform: 'ios' },
      reencode: { verdict: 'unlikely', reasons: ['hevc', 'camera-metadata'] },
      receivedAt: T + 5,
    };
    // A journal written before USB import reads as Wi-Fi.
    expect(stagedImportSchema.parse(staged)).toEqual({ ...staged, channel: 'wifi' });
    expect(stagedImportSchema.safeParse({ ...staged, companions: Array(5).fill('x') }).success).toBe(false);
  });

  it('carries indexing and transfer progress as events', () => {
    const bus = createEventBus({ clock: createManualClock(3) });
    const seen: unknown[] = [];
    bus.onAny((event) => seen.push(taalcutEventSchema.parse(event)));
    const counts = { assets: 1, done: 0, active: 1, waiting: 0, failed: 0 };
    const status: IndexingStatus = { paused: false, overall: counts, sources: [], etaMs: null, updatedAt: T };
    const file = transferFileSchema.parse({
      id: newId<'TransferUpload'>(),
      sessionId: session.id,
      deviceId: newId<'TransferDevice'>(),
      name: 'IMG_0418.MOV',
      sizeBytes: 1000,
      receivedBytes: 500,
      state: 'uploading',
      updatedAt: T,
    });
    bus.emit('library.indexing', status);
    bus.emit('transfer.session', session);
    bus.emit('transfer.file', file);
    expect(seen.map((event) => (event as { type: string }).type)).toEqual([
      'library.indexing',
      'transfer.session',
      'transfer.file',
    ]);
  });
});
