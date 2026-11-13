// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CREATION_COMMANDS as C, newId, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { grantCreationDirectory, resolveCreationDirectory } from '../src/shared/creation-grants';
import { readCreationProgram } from '../src/utility/creation/programs';
import { PUBLISH_CREATION } from '../src/utility/creation/publish';
import { creationSnapshotRoot, snapshotCreationDirectory } from '../src/utility/creation/source-snapshots';
import {
  AGENT,
  SOURCE,
  UI,
  approvedFilm,
  checkpoint,
  creationWorld,
  draftProject,
  publishRow,
} from './helpers/creation';

describe('creation commands with real SQLite and source blobs', () => {
  it('rejects URL credentials and token queries before they reach sources or the command audit', async () => {
    const world = creationWorld();
    const project = await draftProject(world);
    const secret = 'capture-secret-canary';
    const rejected = [
      `https://user:${secret}@product.example/`,
      `https://${secret}@product.example/`,
      ...[
        'access_token',
        'accessToken',
        'refreshToken',
        'id-token',
        'oauth_token',
        'authToken',
        'API_KEY',
        'api-key',
        'apikey',
        'token',
        'secret',
        'password',
        'authorization',
        'x-amz-signature',
        'client_secret',
        'clientSecret',
        'x-amz-credential',
        'x-amz-security-token',
        'to%6ben',
      ].map((key) => `https://product.example/launch?${key}=${secret}`),
      ...['access_token', 'accessToken', 'client_secret', 'x-amz-security-token', 'to%6ben'].flatMap(
        (key) => [
          `https://product.example/launch#${key}=${secret}`,
          `https://product.example/#/launch?${key}=${secret}`,
        ],
      ),
      'http://127.0.0.1/private',
      'file:///etc/hosts',
    ];
    for (const url of rejected) {
      const result = await world.bus.dispatch(
        C.addSource,
        {
          projectId: project.projectId,
          revision: project.revision,
          source: { id: newId<'CreationSource'>(), kind: 'url', label: 'Product', url },
        },
        UI,
      );
      expect(result, url.replaceAll(secret, '[redacted]')).toMatchObject({ ok: false });
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    expect(unwrap(await world.store.get(project.projectId))).toEqual(project);
    expect(JSON.stringify(world.db.driver.prepare('SELECT * FROM commands').all())).not.toContain(secret);
    const safe = 'https://product.example/launch?campaign=november';
    unwrap(
      await world.bus.dispatch(
        C.addSource,
        {
          projectId: project.projectId,
          revision: project.revision,
          source: { id: newId<'CreationSource'>(), kind: 'url', label: 'Product', url: safe },
        },
        UI,
      ),
    );
    expect(unwrap(await world.store.get(project.projectId)).sources[0]?.url).toBe(safe);
  });

  it('preserves manual edits made during production until a new production captures their revision', async () => {
    const world = creationWorld();
    const film = await approvedFilm(world);
    const target = { projectId: film.projectId, timelineId: film.timeline.id, revision: 1 };
    expect(unwrap(await world.store.get(film.projectId)).publicationBase).toEqual([
      { timelineId: film.timeline.id, revision: 1 },
    ]);
    unwrap(
      await world.bus.dispatch(
        C.editProgram,
        { ...target, edits: [{ kind: 'text', target: 'hf-title', text: 'Keep my manual edit' }] },
        UI,
      ),
    );
    const edited = unwrap(await readCreationProgram(world.programs, world.timelines, target));
    const rebuilt = await publishRow(
      world,
      film.projectId,
      SOURCE.replace('Launch</h1>', 'New production</h1>'),
    );
    const row = {
      ...rebuilt,
      timeline: { ...rebuilt.timeline, id: film.timeline.id },
      expectedRevision: edited.timeline.revision,
    };
    const input = { projectId: film.projectId, draftRevision: 1, preview: false, rows: [row] };
    expect((await world.bus.dispatch(PUBLISH_CREATION, input, AGENT)).ok).toBe(false);
    expect(unwrap(await readCreationProgram(world.programs, world.timelines, target))).toEqual(edited);
    unwrap(await world.bus.dispatch(C.cancel, { projectId: film.projectId }, UI));
    const stopped = unwrap(await world.store.get(film.projectId));
    unwrap(
      await world.bus.dispatch(C.produce, { projectId: film.projectId, revision: stopped.revision }, UI),
    );
    unwrap(await world.bus.dispatch(PUBLISH_CREATION, input, AGENT));
    const published = unwrap(await readCreationProgram(world.programs, world.timelines, target));
    expect(published.inspection.source).toContain('New production');
    expect(unwrap(await world.store.get(film.projectId)).publicationBase).toEqual([
      { timelineId: film.timeline.id, revision: published.timeline.revision },
    ]);
  });
  it('requires a person, current draft, answers and visual preview before production', async () => {
    const world = creationWorld();
    let project = await draftProject(world);
    const approve = () => ({
      projectId: project.projectId,
      revision: project.revision,
      draftRevision: project.draft!.revision,
    });
    expect((await world.bus.dispatch(C.approve, approve(), AGENT)).ok).toBe(false);
    project = await checkpoint(world, project, { draft: { ...project.draft!, visualPreviewAssetId: null } });
    expect((await world.bus.dispatch(C.approve, approve(), UI)).ok).toBe(false);
    project = await checkpoint(world, project, {
      draft: {
        ...project.draft!,
        visualPreviewAssetId: newId<'Asset'>(),
        questions: [{ id: 'promise', prompt: 'Which promise?', required: true, answer: null }],
      },
    });
    expect((await world.bus.dispatch(C.approve, approve(), UI)).ok).toBe(false);
    project = await checkpoint(world, project, {
      draft: {
        ...project.draft!,
        questions: [{ ...project.draft!.questions[0]!, answer: 'A concrete benefit' }],
      },
    });
    expect(
      (await world.bus.dispatch(C.approve, { ...approve(), revision: project.revision - 1 }, UI)).ok,
    ).toBe(false);
    unwrap(await world.bus.dispatch(C.approve, approve(), UI));
    const approved = unwrap(await world.store.get(project.projectId));
    expect(approved).toMatchObject({ status: 'producing', approvedDraftRevision: project.draft!.revision });
    expect(
      (
        await world.bus.dispatch(
          C.updateBrief,
          { projectId: project.projectId, revision: approved.revision, brief: project.brief },
          UI,
        )
      ).ok,
    ).toBe(false);
  });

  it('publishes all format manifests and timelines atomically, refusing stale approval and partial publication', async () => {
    const world = creationWorld();
    const project = await draftProject(world);
    const landscape = await publishRow(world, project.projectId);
    const portrait = await publishRow(
      world,
      project.projectId,
      SOURCE.replaceAll('1920', '1080').replace('data-height="1080"', 'data-height="1920"'),
      1080,
      1920,
    );
    const input = {
      projectId: project.projectId,
      draftRevision: project.draft!.revision,
      preview: false,
      rows: [landscape, portrait],
    };
    expect((await world.bus.dispatch(PUBLISH_CREATION, input, AGENT)).ok).toBe(false);
    unwrap(
      await world.bus.dispatch(
        C.approve,
        { projectId: project.projectId, revision: project.revision, draftRevision: project.draft!.revision },
        UI,
      ),
    );
    const bad = { ...input, rows: [landscape, { ...portrait, expectedRevision: 99 }] };
    expect((await world.bus.dispatch(PUBLISH_CREATION, bad, AGENT)).ok).toBe(false);
    expect(unwrap(await world.timelines.listByProject(project.projectId))).toEqual([]);
    expect((await world.programs.get(project.projectId, landscape.program)).ok).toBe(false);
    unwrap(await world.bus.dispatch(PUBLISH_CREATION, input, AGENT));
    expect(unwrap(await world.timelines.listByProject(project.projectId))).toHaveLength(2);
    expect(unwrap(await world.programs.get(project.projectId, landscape.program)).duration.value).toBe(8520);
    expect(unwrap(await world.programs.get(project.projectId, portrait.program)).canvas).toMatchObject({
      width: 1080,
      height: 1920,
    });
  });

  it('edits the source with optimistic revisions, preserves exact undo source and hash after restart, and redoes', async () => {
    const first = creationWorld();
    const film = await approvedFilm(first);
    const target = { projectId: film.projectId, timelineId: film.timeline.id, revision: 1 };
    const before = unwrap(await readCreationProgram(first.programs, first.timelines, target));
    unwrap(
      await first.bus.dispatch(
        C.editProgram,
        { ...target, edits: [{ kind: 'text', target: 'hf-title', text: 'Ready to launch' }] },
        UI,
      ),
    );
    const revised = unwrap(await readCreationProgram(first.programs, first.timelines, target));
    expect(revised.inspection.source).toContain('Ready to launch');
    expect(revised.inspection.program.hash).not.toBe(before.inspection.program.hash);
    expect(
      (
        await first.bus.dispatch(
          C.replaceSource,
          {
            ...target,
            revision: revised.timeline.revision,
            source: SOURCE.replace('const tl=', 'fetch("https://outside.example");const tl='),
          },
          UI,
        )
      ).ok,
    ).toBe(false);
    expect(unwrap(await readCreationProgram(first.programs, first.timelines, target))).toEqual(revised);
    expect((await first.bus.dispatch(C.replaceSource, { ...target, source: SOURCE }, UI)).ok).toBe(false);
    first.db.close();
    const second = creationWorld(first.userData);
    unwrap(await second.bus.undo(film.projectId, UI));
    const undone = unwrap(await readCreationProgram(second.programs, second.timelines, target));
    expect(undone.inspection.source).toBe(before.inspection.source);
    expect(undone.inspection.program.hash).toBe(before.inspection.program.hash);
    expect(undone.timeline.authoredPrograms?.[0]?.hash).toBe(before.inspection.program.hash);
    unwrap(await second.bus.redo(film.projectId, UI));
    const redone = unwrap(await readCreationProgram(second.programs, second.timelines, target));
    expect(redone.inspection.source).toBe(revised.inspection.source);
    expect(redone.inspection.program.hash).toBe(revised.inspection.program.hash);
    expect(redone.timeline.revision).toBeGreaterThan(revised.timeline.revision);
  });

  it('rolls back source publication and timeline edits when the audit write fails', async () => {
    const world = creationWorld();
    const film = await approvedFilm(world);
    const target = { projectId: film.projectId, timelineId: film.timeline.id, revision: 1 };
    const before = unwrap(await readCreationProgram(world.programs, world.timelines, target));
    const count = world.db.driver.prepare('SELECT COUNT(*) AS n FROM authored_programs').get()?.['n'];
    world.db.driver.exec(
      "CREATE TRIGGER reject_creation_edit BEFORE INSERT ON commands WHEN NEW.name='creation.editProgram' BEGIN SELECT RAISE(ABORT, 'audit refused'); END",
    );
    expect(
      (
        await world.bus.dispatch(
          C.editProgram,
          { ...target, edits: [{ kind: 'text', target: 'hf-title', text: 'Never committed' }] },
          UI,
        )
      ).ok,
    ).toBe(false);
    const after = unwrap(await readCreationProgram(world.programs, world.timelines, target));
    expect(after).toEqual(before);
    expect(world.db.driver.prepare('SELECT COUNT(*) AS n FROM authored_programs').get()?.['n']).toBe(count);
  });

  it('keeps directory access opaque and snapshots only approved regular files', async () => {
    const world = creationWorld();
    const project = await draftProject(world);
    const selected = join(world.userData, 'chosen-product');
    await mkdir(join(selected, 'src'), { recursive: true });
    await mkdir(join(selected, 'node_modules'));
    await writeFile(join(selected, 'README.md'), '# Product benefits');
    await writeFile(join(selected, '.env'), 'PRIVATE_TOKEN=secret');
    await writeFile(join(selected, 'node_modules', 'dependency.js'), 'ignored');
    await writeFile(join(selected, 'src', 'view.tsx'), 'export const name = "Product";');
    await writeFile(join(world.userData, 'outside.txt'), 'outside grant');
    await symlink(join(world.userData, 'outside.txt'), join(selected, 'linked.txt'));
    const grant = await grantCreationDirectory(world.userData, selected);
    expect(grant).not.toHaveProperty('path');
    expect(
      (
        await world.bus.dispatch(
          C.addSource,
          {
            projectId: project.projectId,
            revision: project.revision,
            source: { id: newId<'CreationSource'>(), kind: 'directory', label: 'Forged', accessId: selected },
          },
          UI,
        )
      ).ok,
    ).toBe(false);
    unwrap(
      await world.bus.dispatch(
        C.addSource,
        {
          projectId: project.projectId,
          revision: project.revision,
          source: { id: newId<'CreationSource'>(), kind: 'directory', ...grant },
        },
        UI,
      ),
    );
    const saved = unwrap(await world.store.get(project.projectId));
    expect(JSON.stringify(saved.sources)).not.toContain(world.userData);
    const snapshot = unwrap(
      await snapshotCreationDirectory(world.userData, grant.accessId, new AbortController().signal),
    );
    expect(snapshot.files.map((file) => file.path)).toEqual(['README.md', 'src/view.tsx']);
    expect(
      await readFile(join(creationSnapshotRoot(world.userData), snapshot.id, 'source', 'README.md'), 'utf8'),
    ).toBe('# Product benefits');
    await rename(selected, `${selected}-moved`);
    await mkdir(selected);
    expect((await resolveCreationDirectory(world.userData, grant.accessId)).ok).toBe(false);
  });
});
