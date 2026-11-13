// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-X3: saved versions. saveVersion ↔ deleteVersion (redo keeps the id),
 * renameVersion, export snapshots of the rendered revision, and the
 * `projects` namespace over a port: the list with posters and paging, one
 * project, its chat, a timeline's versions.
 */
import {
  fromRpcError,
  newId,
  projectsContract,
  unwrap,
  type DerivedFileRef,
  type TimelineVersionId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createProjectsService, createRenderStore, projectsRouter } from '../../src/index';
import { edited } from '../stores/documents';
import { serveForTest } from './serve';
import { projectsSetup, projectWithTimeline, ui } from './setup';

describe('saved versions', () => {
  it('saves a named version; undo deletes it and redo brings it back under the same id', async () => {
    const setup = projectsSetup();
    const { bus, commands, timelines } = setup;
    const { project, doc } = await projectWithTimeline(setup);
    const receipt = unwrap(
      await bus.dispatch(
        commands.saveVersion,
        { projectId: project.id, timelineId: doc.id, label: ' First cut ' },
        ui,
      ),
    );
    const id = (receipt.result as { versionId: TimelineVersionId }).versionId;
    expect(unwrap(timelines.versions.get(id)).summary).toMatchObject({
      kind: 'named',
      label: 'First cut',
      number: 2,
    });
    unwrap(await bus.undo(project.id, ui));
    expect(timelines.versions.get(id).ok).toBe(false);
    unwrap(await bus.redo(project.id, ui));
    expect(unwrap(timelines.versions.get(id)).summary.label).toBe('First cut');

    unwrap(
      await bus.dispatch(
        commands.renameVersion,
        { projectId: project.id, versionId: id, label: 'Final' },
        ui,
      ),
    );
    expect(unwrap(timelines.versions.get(id)).summary.label).toBe('Final');
    unwrap(await bus.undo(project.id, ui));
    expect(unwrap(timelines.versions.get(id)).summary.label).toBe('First cut');
    const cleared = await bus.dispatch(
      commands.renameVersion,
      { projectId: project.id, versionId: id, label: null },
      ui,
    );
    expect(cleared.ok && unwrap(timelines.versions.get(id)).summary.label).toBeNull();
  });

  it('keeps an export’s revision even after later edits, if a version holds it', async () => {
    const setup = projectsSetup();
    const { timelines } = setup;
    const { doc } = await projectWithTimeline(setup);
    unwrap(await timelines.put(edited(doc, 90), 1));
    // Revision 1 is the assembly's auto version: the export of revision 1 copies its document.
    const exported = unwrap(
      timelines.versions.snapshot({ timelineId: doc.id, kind: 'export', revision: 1 }),
    )!;
    expect([exported.kind, exported.revision]).toEqual(['export', 1]);
    const current = unwrap(timelines.versions.snapshot({ timelineId: doc.id, kind: 'export' }))!;
    expect(current.revision).toBe(2);
    const lost = timelines.versions.snapshot({ timelineId: doc.id, kind: 'export', revision: 7 });
    expect(!lost.ok && lost.error.code).toBe('core.not_found');
  });
});

/** The Taalcut error code a call over the port failed with. */
async function failure(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return 'ok';
  } catch (cause) {
    return fromRpcError(cause).code;
  }
}

describe('projects namespace', () => {
  it('lists projects newest change first with timelines, renders and a poster, in pages', async () => {
    const setup = projectsSetup();
    const { db, repos } = setup;
    const first = await projectWithTimeline(setup);
    const second = await projectWithTimeline(setup);
    const empty = unwrap(repos.projects.create({ name: 'Empty' }));
    unwrap(repos.projects.archive(empty.id));
    const thumbnail: DerivedFileRef = {
      kind: 'thumbnail',
      key: `thumbnails/ab/${'b'.repeat(64)}.v1.jpg`,
      bytes: 2048,
      mimeType: 'image/jpeg',
      width: 320,
      height: 568,
      recipe: 1,
    };
    db.driver
      .prepare(
        `INSERT INTO derived_files (key, asset_id, kind, bytes, mime_type, width, height, recipe, created_at)
         VALUES (?, ?, 'thumbnail', 2048, 'image/jpeg', 320, 568, 1, 1)`,
      )
      .run(thumbnail.key, first.assets[0]);
    const renders = createRenderStore(db);
    unwrap(
      await renders.create({
        id: newId<'Render'>(),
        projectId: first.project.id,
        timelineId: first.doc.id,
        timelineRevision: 1,
        presetId: 'reels',
        status: 'ready',
        jobId: null,
        name: 'Goa – Reels',
        width: 1080,
        height: 1920,
        rate: { num: 30, den: 1 },
        durationFrames: 150,
        bytes: 10,
        music: 'platformSound',
        captions: { burnIn: false, sidecars: [] },
        qa: null,
        supersedes: null,
        notify: false,
        error: null,
        credentials: { added: false, state: null },
        batchId: null,
        createdAt: 1,
        finishedAt: 2,
        deletedAt: null,
        request: {
          projectId: first.project.id,
          timelineId: first.doc.id,
          presetId: 'reels',
          captions: { burnIn: false, sidecars: [] },
          notify: false,
          contentCredentials: { add: false },
          includeBumpers: true,
        },
        filePath: '/Users/me/Movies/Goa.mp4',
        compositionHash: null,
        qaReport: null,
        requestKey: 'k',
      }),
    );
    // The first project's timeline changes last, so it is the newest.
    unwrap(await setup.timelines.put(edited(first.doc, 80), 1));
    const client = serveForTest(projectsContract, projectsRouter(createProjectsService(db)));
    const page1 = await client.list({ limit: 1 });
    expect(page1.items.map((p) => [p.id, p.timelines, p.renders])).toEqual([[first.project.id, 1, 1]]);
    expect(page1.items[0]!.poster).toEqual(thumbnail);
    const page2 = await client.list({ limit: 1, cursor: page1.nextCursor! });
    expect(page2.items.map((p) => [p.id, p.poster])).toEqual([[second.project.id, null]]);
    expect(page2.nextCursor).toBeUndefined();
    expect((await client.list({ archived: true })).items.map((p) => p.name)).toEqual(['Empty']);
    expect((await client.get({ projectId: second.project.id })).name).toBe('Goa trip');
    expect(await failure(client.get({ projectId: newId<'Project'>() }))).toBe('core.not_found');
    expect(await failure(client.list({ cursor: 'nonsense' }))).toBe('core.validation');

    const versions = await client.versions({ timelineId: first.doc.id, limit: 1 });
    expect(versions.items.map((v) => v.number)).toEqual([1]);
    expect(versions.nextCursor).toBeUndefined();
    expect(await failure(client.versions({ timelineId: newId<'Timeline'>() }))).toBe('core.not_found');
  });

  it("names the project's chat: the first conversation moved into it that isn't deleted", async () => {
    const setup = projectsSetup();
    const { db, repos } = setup;
    const { project } = await projectWithTimeline(setup);
    const client = serveForTest(projectsContract, projectsRouter(createProjectsService(db)));
    expect((await client.get({ projectId: project.id })).conversationId).toBeNull();
    const first = unwrap(repos.chat.create({ projectId: project.id }));
    const later = unwrap(repos.chat.create({ projectId: project.id }));
    unwrap(repos.chat.create());
    const born = db.driver.prepare('UPDATE conversations SET created_at = ? WHERE id = ?');
    born.run(10, first.id);
    born.run(20, later.id);
    expect((await client.get({ projectId: project.id })).conversationId).toBe(first.id);
    unwrap(repos.chat.remove(first.id));
    expect((await client.list({})).items.map((p) => p.conversationId)).toEqual([later.id]);
  });
});
