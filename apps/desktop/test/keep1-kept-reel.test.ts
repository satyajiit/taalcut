// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * KEEP1 in the agent process (agent-kept-reel.ts), over a real library database and a real (synthetic) reel: the
 * template's kept reel becomes one library asset, the same one however often a video is made, with the record
 * media the workspace shell brings in gets. So it never counts as one of the person's clips: not in the library's
 * views or its "clips added" count, and render's inventory reads it as generated, not captured. The sink here keeps
 * files under a scratch folder: the app's default is the person's own Movies folder, which a test never touches.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AuditLogStoreToken,
  ClockToken,
  CommandBusToken,
  createCommandBus,
  createContainer,
  createDirectJobRunner,
  createEventBus,
  createManualClock,
  EventBusToken,
  ExperimentSandboxToken,
  GeneratedAssetSinkToken,
  JobRunnerToken,
  newId,
  TEMPLATE_COMMANDS,
  TemplateMediaStoreToken,
  TemplateStoreToken,
  unwrap,
  type AssetProvenance,
  type CommandOrigin,
  type ExperimentSandbox,
  type ProjectId,
  type Template,
} from '@taalcut/core';
import {
  clipsAddedSince,
  createAssetLocationRepository,
  createGeneratedAssetSink,
  createTemplateStore,
  filterSql,
  openDatabase,
} from '@taalcut/library';
import { aiInventory } from '@taalcut/render';
import { planFormat } from '@taalcut/templates';
import { runProcess, SYNTHETIC_REELS, syntheticReelArgs } from '@taalcut/templates/test-support';
import { registerLibraryPorts } from '../src/shared/library-ports';
import { templatesRoot } from '../src/shared/template-assets';
import { CommandUnitOfWorkToken, LibraryDatabaseToken } from '../src/shared/tokens';
import { KEPT_REEL_MODEL, keptReelSource } from '../src/utility/roots/agent-kept-reel';
import { registerTemplateMedia } from '../src/utility/roots/agent-template-media';
import { agentTemplatesRouter } from '../src/utility/roots/agent-templates';
import { testFfmpeg } from './helpers/test-ffmpeg';

const resolved = await testFfmpeg('keep1 kept reel');
if (!resolved.ok) console.warn(`keep1 kept reel: skipped, no FFmpeg (${resolved.error.code})`);

const root = mkdtempSync(join(tmpdir(), 'taalcut-keep1-reel-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const UI: CommandOrigin = { source: 'ui', actor: 'user' };
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

function agent(name: string, options: { sink?: boolean } = {}) {
  const userData = join(root, name);
  const clock = createManualClock(Date.UTC(2026, 10, 15));
  const db = unwrap(openDatabase({ path: ':memory:', clock: () => clock.now() }));
  const events = createEventBus({ clock });
  const container = createContainer()
    .value(ClockToken, clock)
    .value(EventBusToken, events)
    .value(LibraryDatabaseToken, db)
    // A sandbox and a runner, so the templates router (and its commands) compose; nothing here fetches.
    .value(ExperimentSandboxToken, {} as ExperimentSandbox)
    .value(JobRunnerToken, createDirectJobRunner([]));
  registerLibraryPorts(container);
  container
    .factory(CommandBusToken, ({ store }) => createCommandBus({ store, clock }), {
      deps: { store: AuditLogStoreToken },
    })
    .factory(
      TemplateStoreToken,
      ({ commands }) =>
        createTemplateStore(db, { assetsDir: join(templatesRoot(userData), 'assets'), commands }),
      { deps: { commands: CommandUnitOfWorkToken } },
    );
  registerTemplateMedia(container, { userData });
  agentTemplatesRouter(container);
  const originals = join(userData, 'Originals');
  if (options.sink !== false)
    container.value(
      GeneratedAssetSinkToken,
      createGeneratedAssetSink(db, { originalsRoot: () => originals, events }),
    );
  const projectId = newId<'Project'>() as ProjectId;
  db.driver
    .prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, 1, 1)')
    .run(projectId, 'P');
  return { container, db, userData, originals, projectId, bus: container.resolve(CommandBusToken) };
}

async function template(world: ReturnType<typeof agent>): Promise<Template> {
  const made = unwrap(
    planFormat(
      { formatId: 'vlog', targetSeconds: 20, brief: 'a slow morning', createdAt: 1 },
      { template: () => newId(), slot: () => newId(), overlay: () => newId() },
    ),
  );
  unwrap(
    await world.bus.dispatch(
      TEMPLATE_COMMANDS.create,
      { projectId: null, template: made, name: 'Film reel', listed: true },
      UI,
    ),
  );
  return made;
}

async function keep(world: ReturnType<typeof agent>, made: Template, file: string) {
  const media = world.container.resolve(TemplateMediaStoreToken);
  return unwrap(
    await media.keep(made.id, {
      path: file,
      mode: 'copy',
      durationMs: 6_000,
      hasAudio: true,
      source: 'file',
    }),
  );
}

describe.skipIf(!resolved.ok)('the template’s kept reel as a library asset (KEEP1)', () => {
  const reel = join(root, 'reel.mp4');

  it('puts the reel in the library once, recorded as media the app brought in, never as the person’s clip', async () => {
    const binaries = resolved.ok ? resolved.value : (undefined as never);
    const built = await runProcess(binaries.ffmpeg, syntheticReelArgs(SYNTHETIC_REELS[0]!, reel));
    if (!built.ok) throw new Error(built.error.detail);
    const world = agent('kept');
    const made = await template(world);
    const kept = await keep(world, made, reel);
    expect(kept.sha256).toBe(sha(reel));

    const source = keptReelSource(world.container);
    const input = { templateId: made.id, projectId: world.projectId, runId: null };
    const first = unwrap(await source(input));
    expect(first).toEqual({ assetId: expect.any(String) });
    // Made again: the same asset, not another copy.
    expect(unwrap(await source(input))).toEqual(first);
    const { assetId } = first!;
    const count = world.db.driver.prepare('SELECT count(*) AS n FROM assets').get() as { n: number };
    expect(count.n).toBe(1);

    // The bytes are the reel's, in a copy the library manages (never in the template's folder, never re-encoded).
    const location = createAssetLocationRepository(world.db)
      .listByAsset(assetId)
      .find((entry) => entry.state === 'present' && entry.absolutePathCached);
    expect(location?.absolutePathCached?.startsWith(world.originals)).toBe(true);
    expect(sha(location!.absolutePathCached!)).toBe(kept.sha256);

    const row = world.db.driver.prepare('SELECT kind, provenance FROM assets WHERE id = ?').get(assetId) as {
      kind: string;
      provenance: string;
    };
    expect(row.kind).toBe('video');
    const provenance = JSON.parse(row.provenance) as AssetProvenance;
    expect(provenance).toMatchObject({
      kind: 'generated',
      generation: 'workspace',
      provider: 'taalcut',
      model: KEPT_REEL_MODEL,
      access: 'local',
      promptSha256: kept.sha256,
      costUsd: 0,
      runId: null,
    });

    // Not one of the person's clips: the library's default views leave it out, and so does the count the gaps step
    // waits on after "Add more clips".
    const { where, params } = filterSql({});
    const listed = world.db.driver
      .prepare(`SELECT count(*) AS n FROM assets a WHERE ${where}`)
      .get(...params) as {
      n: number;
    };
    expect(listed.n).toBe(0);
    expect(clipsAddedSince(world.db, 0)).toEqual({ added: 0, ready: 0 });
    // Render's inventory reads the kept clip as generated, as it read the old hand recipe's imports: the export's
    // Content Credentials never call it footage the person captured.
    const clip = { type: 'clip', id: 'c1', enabled: true, media: { kind: 'video', assetId } };
    const timeline = {
      tracks: [{ kind: 'video', enabled: true, items: [clip] }],
      voiceover: null,
      music: { path: 'referenceAudio' },
    };
    const inventory = aiInventory(timeline as never, () => provenance.kind);
    expect(inventory.parts.map((part) => [part.kind, part.generated])).toEqual([
      ['clip', true],
      ['music', false],
    ]);
  });

  it('answers nothing when there is no reel to give: none kept, not a video, or no library sink', async () => {
    const world = agent('none');
    const source = keptReelSource(world.container);
    const bare = await template(world);
    expect(unwrap(await source({ templateId: bare.id, projectId: world.projectId, runId: null }))).toBeNull();

    const words = await template(world);
    const text = join(root, 'not-a-video.mp4');
    writeFileSync(text, 'these are words, not a video');
    await keep(world, words, text);
    expect(
      unwrap(await source({ templateId: words.id, projectId: world.projectId, runId: null })),
    ).toBeNull();

    const sinkless = agent('sinkless', { sink: false });
    const made = await template(sinkless);
    await keep(sinkless, made, reel);
    const none = keptReelSource(sinkless.container);
    expect(
      unwrap(await none({ templateId: made.id, projectId: sinkless.projectId, runId: null })),
    ).toBeNull();
    const assets = world.db.driver.prepare('SELECT count(*) AS n FROM assets').get() as { n: number };
    expect(assets.n).toBe(0);
  });
});
