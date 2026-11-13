// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Regression tests for the three library fixes:
 * 1. Immediate `library.changed` announcements when trashing/restoring/reindexing assets.
 * 2. Excluding AI-generated thumbnails, covers and workspace renders from user-facing Library views while preserving
 *    direct lookups and human voice recordings.
 * 3. Storing and serving per-asset Set-of-Mark contact sheets on `assetDetail` and `library.getAsset` (with image
 *    attachments gated by upload consent).
 */
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  createCommandBus,
  createCommitAnnouncer,
  createEventBus,
  FrameRate,
  newId,
  ok,
  RationalTime,
  systemClock,
  unwrap,
  type AnyTool,
  type ArtifactInput,
  type AssetContactSheet,
  type CommandOrigin,
  type CommandToolContext,
  type EventPayload,
  type SourceId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  assetDetail,
  browseAssets,
  clipsAddedSince,
  contactSheetOf,
  createDerivedFileRepository,
  createGeneratedAssetSink,
  createJobRepository,
  createLibraryCommands,
  createLibraryPorts,
  createLibrarySearch,
  createReindexCommand,
  createRepositories,
  createShotProfileSource,
  indexingStatus,
  libraryToolModule,
  listPlaces,
  scanSource,
  sourceViews,
} from '../src/index';
import { assetIndexStages } from '../src/schema/media';
import { openTestDb, tempDir } from './helpers';
import { countingHasher, fakeVolumes, writeMedia } from './sources/fixture';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };

function makePng(width = 640, height = 360): Uint8Array {
  const buf = new Uint8Array(32);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buf.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(buf.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return buf;
}

describe('library fixes: delete events, generated media isolation & contact sheets', () => {
  it('emits library.changed immediately on trashAssets, undo restoreAssets and reindexAssets', async () => {
    const db = openTestDb();
    const home = realpathSync(tempDir());
    const originals = join(home, 'Originals');
    const ports = createLibraryPorts(db);
    const bus = createCommandBus({ store: ports.auditLog, clock: systemClock });
    const events = createEventBus({ clock: systemClock });
    const seen: EventPayload<'library.changed'>[] = [];
    events.on('library.changed', (ev) => seen.push(ev.payload));

    const { hasher } = countingHasher();
    const commands = createLibraryCommands({
      db,
      folders: { protectedRoots: [join(home, 'AppData')], home },
      commands: ports.commands,
      settings: ports.settings,
      defaultOriginalsRoot: originals,
      hasher,
      volumes: fakeVolumes(),
    });
    const reindexAnnouncer = createCommitAnnouncer();
    const reindex = createReindexCommand({ db, commands: ports.commands, announcer: reindexAnnouncer });
    bus.register(...commands.all, reindex);
    commands.announce(bus, events);
    reindexAnnouncer.attach(bus, events);

    const trip = join(home, 'Trip');
    mkdirSync(trip, { recursive: true });
    writeMedia(trip, 'clip.mov', 4096);
    unwrap(await bus.dispatch(commands.addSource, { path: trip, watch: false }, ui));
    for (const job of createJobRepository(db).list()) {
      if (job.kind === 'library.scanSource' && job.state === 'queued') {
        unwrap(
          await scanSource(
            { db, hasher, volumes: fakeVolumes() },
            job.payload as { sourceId: SourceId; mode: 'full' },
          ),
        );
      }
    }
    const [item] = unwrap(browseAssets(db, {})).items;
    expect(item).toBeDefined();
    seen.length = 0;

    unwrap(await bus.dispatch(commands.trashAssets, { assetIds: [item!.id] }, ui));
    expect(seen).toEqual([{ projectId: null, entity: 'asset', change: 'deleted', ids: [item!.id] }]);

    seen.length = 0;
    unwrap(await bus.undo(null, ui));
    expect(seen).toEqual([{ projectId: null, entity: 'asset', change: 'created', ids: [item!.id] }]);

    seen.length = 0;
    unwrap(await bus.dispatch(reindex, { assetIds: [item!.id] }, ui));
    expect(seen).toEqual([{ projectId: null, entity: 'asset', change: 'updated', ids: [item!.id] }]);
  });

  it('hides AI-generated thumbnails and workspace renders from user library views while keeping recordings and direct lookups', async () => {
    const db = openTestDb();
    const home = realpathSync(tempDir());
    const originals = join(home, 'Originals');
    const sink = createGeneratedAssetSink(db, { originalsRoot: originals });
    const projectId = newId<'Project'>();
    db.driver
      .prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, 1, 1)')
      .run(projectId, 'Project');

    const thumb = unwrap(
      await sink.put({
        bytes: makePng(1080, 1920),
        mediaType: 'image/png',
        fileName: 'ai-thumbnail.png',
        provenance: {
          kind: 'generated',
          generation: 'image',
          provider: 'openai',
          model: 'gpt-image-2',
          access: 'api-key',
          quality: null,
          promptSha256: 'a'.repeat(64),
          voiceId: null,
          providerRef: null,
          c2pa: 'present',
          costUsd: 0.02,
          runId: null,
          createdAt: 1,
        },
        projectId,
      }),
    );

    // Human voice recording lands in Generated folder with `provenance.kind === 'captured'`.
    const rec = unwrap(
      await sink.putRecording!({
        bytes: new TextEncoder().encode('saved human voiceover take'),
        fileName: 'narration.wav',
        mediaType: 'audio/wav',
        provenance: { kind: 'captured' },
        projectId,
        duration: RationalTime.of(48_000, { num: 48_000, den: 1 }),
      }),
    );

    // Default user-facing Library views exclude AI-generated thumbnails, but keep human voice recordings.
    const browsed = unwrap(browseAssets(db, {})).items.map((a) => a.id);
    expect(browsed).not.toContain(thumb.assetId);
    expect(browsed).toContain(rec.assetId);

    // Opt-in `includeGenerated: true` reveals generated items when explicitly asked.
    const withGenerated = unwrap(browseAssets(db, { filters: { includeGenerated: true } })).items.map(
      (a) => a.id,
    );
    expect(withGenerated).toContain(thumb.assetId);

    // Source views, indexing status (1 = only the human recording, not the generated thumbnail), automatic casting
    // (`list`/`recent`), and `listPlaces` exclude generated items.
    expect(sourceViews(db)).toEqual([]);
    expect(indexingStatus(db, { paused: false }).overall.assets).toBe(1);
    const profiles = createShotProfileSource({ db });
    expect(unwrap(await profiles.list({}, 50)).map((p) => p.assetId)).not.toContain(thumb.assetId);
    expect(clipsAddedSince(db, 0).added).toBe(0);
    expect(listPlaces(db)).toEqual([]);

    // Direct lookups by ID (`assetDetail` and `profiles(refs)`) still resolve the generated thumbnail cleanly.
    expect(unwrap(assetDetail(db, thumb.assetId)).asset.id).toBe(thumb.assetId);
    const direct = unwrap(await profiles.profiles([{ assetId: thumb.assetId, shotId: null }]));
    expect(direct).toHaveLength(1);
    expect(direct[0]!.assetId).toBe(thumb.assetId);
  });

  it('exposes contactSheet on assetDetail and attaches image + tile metadata in library.getAsset', async () => {
    const db = openTestDb();
    const home = realpathSync(tempDir());
    const { hasher } = countingHasher();
    const trip = join(home, 'Trip');
    mkdirSync(trip, { recursive: true });
    writeMedia(trip, 'beach.mov', 8192);
    const repos = createRepositories(db);
    const source = unwrap(
      repos.sources.add({
        kind: 'watched_folder',
        displayName: 'Trip',
        rootPath: trip,
        watch: false,
      }),
    );
    unwrap(await scanSource({ db, hasher, volumes: fakeVolumes() }, { sourceId: source.id, mode: 'full' }));
    const [asset] = repos.assets.list();
    expect(asset).toBeDefined();
    const rate = FrameRate.of(30);
    const hash = 'ab'.repeat(32);
    db.driver
      .prepare("UPDATE assets SET content_hash = ?, content_hash_alg = 'blake3' WHERE id = ?")
      .run(hash, asset!.id);
    const key = `stills/${hash.slice(0, 2)}/${hash}.contact-sheet.v1.jpg`;
    const sheet: AssetContactSheet = {
      file: {
        kind: 'still',
        key,
        bytes: 4096,
        mimeType: 'image/jpeg',
        width: 960,
        height: 270,
        frameRate: rate,
        recipe: 1,
      },
      width: 960,
      height: 270,
      columns: 4,
      tileWidth: 240,
      tileHeight: 135,
      frameRate: rate,
      layout: [
        { tile: 0, frame: 0, at: RationalTime.of(0, rate) },
        { tile: 1, frame: 45, at: RationalTime.of(45, rate) },
      ],
    };

    unwrap(createDerivedFileRepository(db).put(asset!.id, [sheet.file]));
    db.orm
      .insert(assetIndexStages)
      .values({
        assetId: asset!.id,
        stage: 'vision.contactSheet',
        state: 'done',
        version: 1,
        generation: 1,
        output: { contactSheet: sheet },
        updatedAt: 1,
      })
      .run();

    expect(contactSheetOf(db, asset!.id)).toEqual(sheet);
    expect(unwrap(assetDetail(db, asset!.id)).contactSheet).toEqual(sheet);

    let consentShown = true;
    const storedArtifacts: ArtifactInput[] = [];
    const search = createLibrarySearch({ db, vectors: null, embedder: null });
    const mod = libraryToolModule({
      db,
      search,
      importStatus: async () => ok(indexingStatus(db, { paused: false })),
      contactSheet: async () =>
        ok({
          bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
          pictures: { shown: consentShown, why: consentShown ? 'On this Mac' : 'No consent' },
        }),
    });
    const getAsset = mod.tools.find((t) => t.name === 'library.getAsset')! as AnyTool;
    const ctx: CommandToolContext = {
      signal: new AbortController().signal,
      callId: newId<'ToolRun'>(),
      runId: newId<'AgentRun'>(),
      attempt: 1,
      artifacts: {
        put: async (artifact) => {
          storedArtifacts.push(artifact);
          return ok({
            id: newId<'Artifact'>(),
            mediaType: artifact.mediaType,
            bytes: 4,
            summary: artifact.summary,
          });
        },
        get: async () => {
          throw new Error('unused');
        },
      },
      reportUsage: () => {},
      reportProgress: () => {},
      dispatch: async () => {
        throw new Error('unused');
      },
    };

    const outShown = unwrap(await getAsset.run(getAsset.input.parse({ assetId: asset!.id }), ctx)) as {
      contactSheet?: { image: unknown; tiles: { badge: string; frame: number }[]; pictures: { footage: string } };
    };
    expect(outShown.contactSheet?.pictures.footage).toBe('shown');
    expect(outShown.contactSheet?.tiles.map((t) => [t.badge, t.frame])).toEqual([
      ['#1', 0],
      ['#2', 45],
    ]);
    expect(getAsset.images?.(outShown)).toHaveLength(1);
    expect(storedArtifacts).toHaveLength(1);

    // Without upload consent, tile metadata is still returned, but no image artifact is sent.
    consentShown = false;
    const outKept = unwrap(await getAsset.run(getAsset.input.parse({ assetId: asset!.id }), ctx)) as {
      contactSheet?: { image: unknown; pictures: { footage: string } };
    };
    expect(outKept.contactSheet?.pictures.footage).toBe('kept_on_device');
    expect(outKept.contactSheet?.image).toBeNull();
    expect(getAsset.images?.(outKept)).toEqual([]);

    // Once evicted from `derived_files`, `contactSheetOf` returns null cleanly.
    unwrap(createDerivedFileRepository(db).removeKeys([key]));
    expect(contactSheetOf(db, asset!.id)).toBeNull();
  });
});
