// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUTHORED_PROGRAM_LIMITS,
  FrameRates,
  RationalTime,
  authoredProgramDigestInput,
  createCommandBus,
  defineCommand,
  newId,
  ok,
  unwrap,
  workspaceBlobPath,
  type AuthoredProgram,
  type CreationProject,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  authoredProgramRoot,
  createAuthoredProgramStore,
  createCreationStore,
  createLibraryPorts,
  createProjectRepository,
} from '../src/index';
import { openTestDb, tempDir } from './helpers';

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);
function setup(dataRoot = tempDir()) {
  const db = openTestDb({ path: join(dataRoot, 'library.db') });
  const ports = createLibraryPorts(db);
  const programs = createAuthoredProgramStore(db, { dataRoot, commands: ports.commands });
  const creations = createCreationStore(db, { commands: ports.commands });
  const bus = createCommandBus({ store: ports.auditLog, clock: { now: () => 1000 } });
  return { dataRoot, db, programs, creations, bus };
}
function projectOf(world: ReturnType<typeof setup>): CreationProject {
  const projectId = unwrap(createProjectRepository(world.db).create({ name: '142 second launch' })).id;
  return {
    projectId,
    revision: 1,
    brief: {
      category: 'product-launch',
      title: '142 second launch',
      prompt: 'A continuous product journey',
      audience: '',
      callToAction: '',
      formats: ['16:9'],
      duration: RationalTime.of(8520, FrameRates.fps60),
      voice: { mode: 'none', voiceId: null, assetId: null, language: 'en' },
    },
    sources: [],
    draft: null,
    approvedDraftRevision: null,
    status: 'draft',
    tasks: [],
    budget: { capMicros: null, spentMicros: 0, reservedMicros: 0 },
    timelineId: null,
    error: null,
    createdAt: 1000,
    updatedAt: 1000,
  };
}
async function programOf(
  world: ReturnType<typeof setup>,
  project: CreationProject,
  source = '<main>Full 142 second composition</main>',
) {
  const file = unwrap(await world.programs.putFile(project.projectId, bytes(source)));
  const program: AuthoredProgram = {
    id: newId<'AuthoredProgram'>(),
    hash: '0'.repeat(64),
    version: 1,
    entry: 'film-16-9.html',
    files: [{ path: 'film-16-9.html', ...file }],
    canvas: { width: 1920, height: 1080, rate: FrameRates.fps60 },
    duration: project.brief.duration,
    chapters: [],
    assetIds: [],
  };
  return { ...program, hash: createHash('sha256').update(authoredProgramDigestInput(program)).digest('hex') };
}

describe('creation and authored source stores on SQLite', () => {
  it('hides archived creations while retaining their source and restores them on unarchive', async () => {
    const world = setup();
    const project = projectOf(world);
    const program = await programOf(world, project);
    unwrap(await world.creations.save(project, 0));
    unwrap(await world.programs.save(project.projectId, program));
    const projects = createProjectRepository(world.db);
    unwrap(projects.archive(project.projectId));
    expect(unwrap(await world.creations.list())).toEqual([]);
    expect(unwrap(await world.programs.get(project.projectId, program))).toEqual(program);
    unwrap(projects.unarchive(project.projectId));
    expect(unwrap(await world.creations.list())).toEqual([project]);
  });
  it('retains a 142 second source, project revision and bytes across restart with project isolation', async () => {
    const first = setup();
    const project = projectOf(first);
    const source = '<main>Continuous film, original logo and cursor path</main>';
    const program = await programOf(first, project, source);
    unwrap(await first.creations.save(project, 0));
    unwrap(await first.programs.save(project.projectId, program));
    first.db.close();
    const second = setup(first.dataRoot);
    expect(unwrap(await second.creations.get(project.projectId))).toEqual(project);
    expect(unwrap(await second.programs.get(project.projectId, program))).toEqual(program);
    expect(RationalTime.toSeconds(program.duration)).toBe(142);
    expect(text(unwrap(await second.programs.readFile(project.projectId, program.files[0]!.sha256)))).toBe(
      source,
    );
    expect((await second.programs.get(newId<'Project'>(), program)).ok).toBe(false);
    expect((await second.programs.readFile(newId<'Project'>(), program.files[0]!.sha256)).ok).toBe(false);
  });

  it('refuses stale or invalid project revisions and does not silently load corrupted state', async () => {
    const world = setup();
    const project = projectOf(world);
    unwrap(await world.creations.save(project, 0));
    const revised = { ...project, revision: 2, updatedAt: 2000 };
    unwrap(await world.creations.save(revised, 1));
    expect(await world.creations.save(revised, 1)).toMatchObject({
      ok: false,
      error: { code: 'core.conflict' },
    });
    expect(await world.creations.save({ ...revised, revision: 4 }, 2)).toMatchObject({
      ok: false,
      error: { code: 'core.validation' },
    });
    expect(unwrap(await world.creations.list())).toEqual([revised]);
    world.db.driver
      .prepare('UPDATE creation_projects SET state = ? WHERE project_id = ?')
      .run('{}', project.projectId);
    expect((await world.creations.get(project.projectId)).ok).toBe(false);
    expect((await world.creations.list()).ok).toBe(false);
  });

  it('verifies manifest digest, blob size, content hash, missing blobs and source bounds', async () => {
    const world = setup();
    const project = projectOf(world);
    const program = await programOf(world, project);
    expect((await world.programs.save(project.projectId, { ...program, hash: 'f'.repeat(64) })).ok).toBe(
      false,
    );
    const wrongSize = {
      ...program,
      files: program.files.map((file) => ({ ...file, bytes: file.bytes + 1 })),
    };
    wrongSize.hash = createHash('sha256').update(authoredProgramDigestInput(wrongSize)).digest('hex');
    expect((await world.programs.save(project.projectId, wrongSize)).ok).toBe(false);
    expect(
      (await world.programs.putFile(project.projectId, new Uint8Array(AUTHORED_PROGRAM_LIMITS.fileBytes + 1)))
        .ok,
    ).toBe(false);
    expect((await world.programs.readFile(project.projectId, '../escape')).ok).toBe(false);
    expect((await world.programs.readFile(project.projectId, 'c'.repeat(64))).ok).toBe(false);
    const file = program.files[0]!;
    writeFileSync(
      join(authoredProgramRoot(world.dataRoot), workspaceBlobPath(project.projectId, file.sha256)),
      'tampered',
    );
    expect((await world.programs.readFile(project.projectId, file.sha256)).ok).toBe(false);
    expect((await world.programs.save(project.projectId, program)).ok).toBe(false);
  });

  it('rolls both project and manifest writes back when the command audit insert fails', async () => {
    const world = setup();
    const project = projectOf(world);
    const program = await programOf(world, project);
    world.bus.register(
      defineCommand({
        name: 'test.publishCreation',
        payload: z.object({}),
        sideEffect: 'write',
        project: () => project.projectId,
        handle: async (_input, context) => {
          const saved = await world.creations.save(project, 0, context);
          if (!saved.ok) return saved;
          const published = await world.programs.save(project.projectId, program, context);
          return published.ok ? ok({ result: null }) : published;
        },
      }),
    );
    world.db.driver.exec(
      "CREATE TRIGGER reject_creation_audit BEFORE INSERT ON commands BEGIN SELECT RAISE(ABORT, 'audit refused'); END",
    );
    expect((await world.bus.dispatch('test.publishCreation', {}, { source: 'ui', actor: 'user' })).ok).toBe(
      false,
    );
    expect((await world.creations.get(project.projectId)).ok).toBe(false);
    expect((await world.programs.get(project.projectId, program)).ok).toBe(false);
    expect(world.db.driver.prepare('SELECT COUNT(*) AS count FROM commands').get()?.['count']).toBe(0);
  });
});
