// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import {
  connectRpc,
  CREATION_COMMANDS,
  FrameRates,
  GeneratedAssetSinkToken,
  newId,
  ok,
  RationalTime,
  serveRpc,
  unwrap,
  UTILITY_CONTRACTS,
  VoiceProviderToken,
} from '@taalcut/core';
import type { CreationScene } from '@taalcut/agent';
import { renderPaths } from '../src/shared/render-paths';
import { composeRender } from '../src/utility/roots/render-root';
import { publishCreation } from '../src/utility/creation/publish';
import { readCreationProgram } from '../src/utility/creation/programs';
import { createCreationVoice } from '../src/utility/creation/voice';
import { checkpoint, creationWorld, draftProject, UI } from './helpers/creation';
import { testConfig } from './helpers/roots';
import { testFfmpeg } from './helpers/test-ffmpeg';
import { hasTestHeadlessShell } from './helpers/test-headless-shell';

/** The real render process captures with the headless browser and encodes with FFmpeg. */
const suite = 'Create, native production path';
const canRender = hasTestHeadlessShell(suite) && (await testFfmpeg(suite)).ok;

describe('Create uses the native production path', { timeout: 120_000 }, () => {
  it('publishes a master camera and moving cursor, then opens it in the real render process', async ({
    skip,
  }) => {
    skip(!canRender);
    const world = creationWorld();
    const before = await draftProject(world);
    const beat = { ...before.draft!.beats[0]!, duration: RationalTime.of(180, FrameRates.fps60) };
    const project = await checkpoint(world, before, {
      draft: { ...before.draft!, beats: [beat], questions: [] },
    });
    unwrap(
      await world.bus.dispatch(
        CREATION_COMMANDS.approve,
        {
          projectId: project.projectId,
          revision: project.revision,
          draftRevision: project.draft!.revision,
        },
        UI,
      ),
    );
    const approved = unwrap(await world.store.get(project.projectId));
    const scene: CreationScene = {
      beatId: beat.id,
      format: '16:9',
      html: '<h1 id="one-title" data-hf-id="one-title">One continuous film</h1>',
      css: '#one-title{position:absolute;left:120px;top:200px;font-size:96px;color:#ffffff;}',
      animation: "tl.fromTo('#one-title',{opacity:0},{opacity:1,duration:0.5},0);",
    };
    const master: CreationScene = {
      beatId: 'master',
      format: '16:9',
      html: '<div id="master-cursor" data-hf-id="master-cursor"></div>',
      css: '#master-cursor{position:absolute;width:36px;height:36px;left:0px;top:700px;background:#ffffff;}',
      animation:
        "tl.fromTo('#master-cursor',{x:0},{x:900,duration:3,ease:'none'},0);tl.fromTo('#master-camera',{x:0},{x:200,duration:3,ease:'none'},0);",
    };
    const published = await publishCreation(
      world.container,
      {
        project: approved,
        draft: approved.draft!,
        scenes: [scene],
        masterScenes: [master],
        voice: null,
      },
      new AbortController().signal,
    );
    expect(published.ok, JSON.stringify(published)).toBe(true);
    const timelineId = unwrap(published);
    const inspected = unwrap(
      await readCreationProgram(world.programs, world.timelines, {
        projectId: approved.projectId,
        timelineId,
      }),
    );
    expect(inspected.inspection.source).toContain('master-camera');
    expect(inspected.inspection.source).toContain('master-cursor');
    const config = testConfig('render', join(world.userData, 'library.db'), world.userData);
    const root = await composeRender(config);
    const { port1, port2 } = new MessageChannel();
    serveRpc(root.router, port1, { context: { caller: 'main' }, exposeDetail: true });
    try {
      const client = connectRpc(UTILITY_CONTRACTS.render, port2, { peer: 'render' }).client;
      const preview = await client.renders.openPreview({ projectId: approved.projectId, timelineId });
      const token = /^app:\/\/preview\/([0-9a-f]{32})\//.exec(preview.url)![1]!;
      const html = await readFile(join(renderPaths(world.userData).preview, token, 'index.html'), 'utf8');
      expect(html).toContain('One continuous film');
      expect(html).toContain('master-cursor');
      const early = await client.worker.captureFrame({
        projectId: approved.projectId,
        timelineId,
        frame: 30,
        source: { kind: 'preview' },
        maxDimension: 768,
      });
      const late = await client.worker.captureFrame({
        projectId: approved.projectId,
        timelineId,
        frame: 150,
        source: { kind: 'preview' },
        maxDimension: 768,
      });
      expect(early.dataBase64.length).toBeGreaterThan(1000);
      expect(early.dataBase64).not.toBe(late.dataBase64);
      expect(late.width / late.height).toBeCloseTo(16 / 9, 1);
    } finally {
      port1.close();
      port2.close();
      await root.container.dispose();
    }
  });

  it('makes one continuous provider read and keeps measured beat boundaries', async () => {
    const world = creationWorld();
    const project = await draftProject(world);
    const assetId = newId<'Asset'>();
    let calls = 0;
    world.container.value(GeneratedAssetSinkToken, {
      put: async () => ok({ assetId, contentHash: 'a'.repeat(64), duplicate: false }),
    });
    world.container.value(VoiceProviderToken, {
      available: () => ({ ok: true }),
      voices: async () => ok([]),
      async synthesize(request) {
        calls++;
        const characters = [...request.text];
        return ok({
          bytes: new Uint8Array([1, 2, 3]),
          mediaType: 'audio/mpeg',
          sampleRate: 48_000,
          provider: 'recorded',
          model: 'recorded',
          costUsd: 0.1,
          c2pa: 'absent',
          alignment: {
            characters,
            startSeconds: characters.map((_, index) => index / 10),
            endSeconds: characters.map((_, index) => (index + 1) / 10),
          },
        });
      },
      createClone: async () => ok({ voiceId: 'test', requiresVerification: false }),
      deleteClone: async () => ok(undefined),
    });
    const draft = {
      ...project.draft!,
      beats: [
        { ...project.draft!.beats[0]!, narration: 'Hello.' },
        { ...project.draft!.beats[0]!, id: 'two', narration: 'Together.' },
      ],
    };
    const voice = unwrap(
      await createCreationVoice(
        world.container,
        {
          ...project,
          brief: {
            ...project.brief,
            voice: { mode: 'connected', voiceId: 'test', assetId: null, language: 'en' },
          },
        },
        draft,
        new AbortController().signal,
      ),
    );
    expect(calls).toBe(1);
    expect(voice.lines.map((line) => line.assetId)).toEqual([assetId, assetId]);
    expect(voice.lines[0]!.sourceStartMs! + voice.lines[0]!.durationMs).toBe(voice.lines[1]!.sourceStartMs);
    expect(voice.usageMicros).toBe(100_000);
  });
});
