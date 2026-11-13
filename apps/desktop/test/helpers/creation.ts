// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import {
  AuthoredProgramStoreToken,
  CommandBusToken,
  CreationStoreToken,
  EventBusToken,
  FrameRates,
  RationalTime,
  SettingsStoreToken,
  TimelineStoreToken,
  CREATION_COMMANDS as C,
  authoredProgramDigestInput,
  createCommandBus,
  createContainer,
  createEventBus,
  createManualClock,
  newId,
  unwrap,
  type CreationDraft,
  type CreationProject,
  type ProjectId,
} from '@taalcut/core';
import {
  LibraryDatabaseToken,
  LibraryPortsToken,
  createLibraryPorts,
  createTimelineStore,
  openDatabase,
} from '@taalcut/library';
import { createAuthoredTimeline } from '@taalcut/timeline';
import { creationCommands, SAVE_CREATION_STATE } from '../../src/utility/creation/commands';
import { creationPublishCommand, PUBLISH_CREATION } from '../../src/utility/creation/publish';
import { registerCreationStores } from '../../src/utility/creation/stores';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
export const UI = { source: 'ui', actor: 'user' } as const;
export const AGENT = { source: 'agent', actor: 'creation:test' } as const;
export const SOURCE = `<template><style>#root{width:1920px;height:1080px;background:#101218}#title{color:white;font-size:96px}</style><div id="root" data-composition-id="film" data-width="1920" data-height="1080" data-duration="142"><h1 id="title" data-hf-id="hf-title">Launch</h1></div><script>const tl=gsap.timeline({paused:true});tl.fromTo('#title',{x:0},{x:600,duration:142,ease:'none'},0);window.__timelines['film']=tl;</script></template>`;

export function creationWorld(existingRoot?: string) {
  const userData = existingRoot ?? mkdtempSync(join(tmpdir(), 'taalcut-creation-test-'));
  if (!existingRoot) cleanups.push(() => rmSync(userData, { force: true, recursive: true }));
  const clock = createManualClock(1000);
  const db = unwrap(openDatabase({ path: join(userData, 'library.db'), clock: () => clock.now() }));
  cleanups.push(() => db.close());
  const ports = createLibraryPorts(db);
  const bus = createCommandBus({ store: ports.auditLog, clock });
  const timelines = createTimelineStore(db, { commands: ports.commands });
  const container = createContainer()
    .value(LibraryDatabaseToken, db)
    .value(LibraryPortsToken, ports)
    .value(SettingsStoreToken, ports.settings)
    .value(CommandBusToken, bus)
    .value(EventBusToken, createEventBus({ clock }))
    .value(TimelineStoreToken, timelines);
  registerCreationStores(container, userData);
  bus.register(...creationCommands(container, userData).all, creationPublishCommand(container));
  const store = container.resolve(CreationStoreToken);
  const programs = container.resolve(AuthoredProgramStoreToken);
  return { userData, db, bus, store, programs, timelines, container };
}
export type CreationWorld = ReturnType<typeof creationWorld>;

export async function checkpoint(
  world: CreationWorld,
  before: CreationProject,
  patch: Partial<CreationProject>,
) {
  const project = { ...before, ...patch, revision: before.revision + 1, updatedAt: before.updatedAt + 1 };
  unwrap(
    await world.bus.dispatch(SAVE_CREATION_STATE, { project, expectedRevision: before.revision }, AGENT),
  );
  return unwrap(await world.store.get(project.projectId));
}

export async function draftProject(world: CreationWorld) {
  const projectId = newId<'Project'>();
  const duration = RationalTime.of(8520, FrameRates.fps60);
  unwrap(
    await world.bus.dispatch(
      C.create,
      {
        projectId,
        brief: {
          category: 'product-launch',
          title: 'Launch',
          prompt: 'Continuous camera and product story',
          audience: '',
          callToAction: 'Try it',
          formats: ['16:9'],
          duration,
          voice: { mode: 'none', voiceId: null, assetId: null, language: 'en' },
        },
      },
      UI,
    ),
  );
  const project = unwrap(await world.store.get(projectId));
  const draft: CreationDraft = {
    revision: 1,
    title: 'Launch',
    visualDirection: 'One camera and original mark',
    visualPreviewAssetId: newId<'Asset'>(),
    beats: [
      {
        id: 'one',
        duration,
        narration: 'Launch together',
        screenText: 'Launch',
        visual: 'One object',
        transition: 'Hold',
      },
    ],
    questions: [],
  };
  return checkpoint(world, project, { draft, status: 'awaiting-approval' });
}

export async function publishRow(
  world: CreationWorld,
  projectId: ProjectId,
  source = SOURCE,
  width = 1920,
  height = 1080,
) {
  const file = unwrap(await world.programs.putFile(projectId, new TextEncoder().encode(source)));
  const base = {
    id: newId<'AuthoredProgram'>(),
    hash: '0'.repeat(64),
    version: 1,
    entry: 'film-16-9.html',
    files: [{ path: 'film-16-9.html', ...file }],
    canvas: { width, height, rate: FrameRates.fps60 },
    duration: RationalTime.of(8520, FrameRates.fps60),
    chapters: [],
    assetIds: [],
  };
  const program = {
    ...base,
    hash: createHash('sha256').update(authoredProgramDigestInput(base)).digest('hex'),
  };
  const timeline = unwrap(createAuthoredTimeline({ projectId, program, name: 'Launch' }));
  return { program, timeline, expectedRevision: 0 };
}

export async function approvedFilm(world: CreationWorld) {
  const project = await draftProject(world);
  unwrap(
    await world.bus.dispatch(
      C.approve,
      { projectId: project.projectId, revision: project.revision, draftRevision: project.draft!.revision },
      UI,
    ),
  );
  const row = await publishRow(world, project.projectId);
  unwrap(
    await world.bus.dispatch(
      PUBLISH_CREATION,
      { projectId: project.projectId, draftRevision: project.draft!.revision, preview: false, rows: [row] },
      AGENT,
    ),
  );
  return { projectId: project.projectId, ...row };
}
