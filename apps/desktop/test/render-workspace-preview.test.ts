// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-WS: the render process's root gives the engine the workspace root, so a composition graphic reaches the
 * preview compile. Its file goes in through the library's workspace store, under the root's own user-data folder;
 * the renders router opens a preview of a timeline that places it, and the session's page draws it with its words.
 * The composition is a made-up test fixture (test/fixtures/workspace/card.html), not a shipped design.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import {
  connectRpc,
  DEFAULT_MIX,
  FrameRates,
  graphicCompositionSchema,
  newId,
  RationalTime,
  serveRpc,
  TIMELINE_SCHEMA_VERSION,
  unwrap,
  UTILITY_CONTRACTS,
  WorkspaceStoreToken,
  type ProjectId,
  type Timeline,
} from '@taalcut/core';
import { createRepositories, createTimelineStore } from '@taalcut/library';
import { renderPaths } from '../src/shared/render-paths';
import { LibraryDatabaseToken } from '../src/shared/tokens';
import { composeRender } from '../src/utility/roots/render-root';
import type { UtilityRoot } from '../src/utility/runtime';
import { testConfig } from './helpers/roots';

const WORDS = 'Made-up words on a card';
const rate = FrameRates.fps30;
const at = (frames: number) => RationalTime.of(frames, rate);

const roots: UtilityRoot[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await root.container.dispose();
});

/** A 4-second timeline: a gap on V1, and the composition graphic on a text track from 0:01 for 3 s. */
function timelineWith(
  projectId: ProjectId,
  copy: ReturnType<typeof graphicCompositionSchema.parse>,
): Timeline {
  const now = Date.UTC(2026, 10, 2);
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: newId<'Timeline'>(),
    projectId,
    name: 'Made-up timeline',
    revision: 1,
    canvas: { width: 1080, height: 1920, rate },
    template: null,
    beatMap: null,
    tracks: [
      {
        kind: 'video',
        id: 'V1',
        name: 'Video',
        enabled: true,
        items: [{ type: 'gap', id: newId<'TimelineItem'>(), duration: at(120), slotId: null }],
      },
      {
        kind: 'text',
        id: 'T1',
        name: 'Graphics',
        enabled: true,
        items: [
          {
            type: 'graphic',
            id: newId<'TimelineItem'>(),
            anchor: { kind: 'time', at: at(30) },
            start: at(30),
            duration: at(90),
            placement: 'middle',
            styleKey: 'graphic',
            language: 'en',
            origin: 'agent',
            composition: { id: copy.id, hash: copy.hash, params: { words: WORDS } },
          },
        ],
      },
    ],
    markers: [],
    cast: null,
    captions: null,
    music: { path: 'platformSound' },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    graphicCompositions: [copy],
    createdAt: now,
    updatedAt: now,
  } as Timeline;
}

describe('a composition graphic in the render process (HFW1-WS)', { timeout: 120_000 }, () => {
  it('reaches the preview compile from the workspace blobs under the user-data folder', async () => {
    const config = testConfig('render');
    const root = await composeRender(config, 21);
    roots.push(root);
    const db = root.container.resolve(LibraryDatabaseToken);
    const projectId = unwrap(createRepositories(db).projects.create({ name: 'Made-up project' })).id;

    const html = await readFile(join(import.meta.dirname, 'fixtures', 'workspace', 'card.html'), 'utf8');
    const put = unwrap(
      await root.container.resolve(WorkspaceStoreToken).putBlob(projectId, new TextEncoder().encode(html)),
    );
    const copy = graphicCompositionSchema.parse({
      id: newId<'GraphicComposition'>(),
      version: 1,
      hash: 'c'.repeat(64),
      name: 'Card',
      entry: 'index.html',
      files: [{ path: 'index.html', sha256: put.sha256, bytes: put.bytes }],
      variables: [{ type: 'text', name: 'words', maxLength: 80, sample: 'Lorem ipsum' }],
      durationSeconds: 3,
      provenance: { model: { id: 'stand-in', onDevice: true }, overlays: [], brief: null, createdAt: 1 },
      gate: {
        version: 'test-gate/1',
        passed: true,
        checkedAt: 1,
        hfLint: { errors: 0, warnings: 0 },
        checks: [],
        loweredTweens: 2,
      },
    });
    const timeline = timelineWith(projectId, copy);
    unwrap(await createTimelineStore(db).create(timeline));

    const { port1, port2 } = new MessageChannel();
    serveRpc(root.router, port1, { context: { caller: 'main' } });
    const render = connectRpc(UTILITY_CONTRACTS.render, port2, { peer: 'render' }).client;
    const session = await render.renders.openPreview({ projectId, timelineId: timeline.id });
    const token = /^app:\/\/preview\/([0-9a-f]{32})\//.exec(session.url)![1]!;
    const index = await readFile(join(renderPaths(config.userData).preview, token, 'index.html'), 'utf8');
    expect(index).toContain(WORDS);
    expect(index).toContain('tc-comp');
    port1.close();
    port2.close();
  });
});
