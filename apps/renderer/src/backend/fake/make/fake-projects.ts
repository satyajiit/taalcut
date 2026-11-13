// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `appContract.projects` and the project commands as the fake serves them
 * (P2-X3): the project list, saved versions of each timeline (autosaves,
 * named ones, the snapshot an export keeps and the one a restore takes
 * first) and restoring one, which is itself undoable: its inverse restores
 * the before-restore snapshot it took, reusing that id on redo.
 */
import {
  defineCommand,
  err,
  NotFoundError,
  ok,
  PROJECT_COMMANDS,
  projectCommandPayloads,
  type AnyCommand,
  type ConversationId,
  type EventBus,
  type ProjectId,
  type ProjectSummary,
  type Timeline,
  type TimelineId,
  type TimelineVersionId,
  type TimelineVersionSummary,
} from '@taalcut/core';
import { FIXTURE_NOW } from '../library/assets';
import { fakeUlid } from '../library/seed';
import type { FakeTimelines } from './fake-timelines';
import { MAKE_KIND, type IdMaker } from './ids';
import type { SeededProject } from './seeded-project';
import type { PoolShot } from './shot-pool';

const HOUR = 3_600_000;
const P = projectCommandPayloads;

interface StoredVersion {
  summary: TimelineVersionSummary;
  snapshot: Timeline;
}

interface StoredProject {
  id: ProjectId;
  name: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  /** The chat that made it: a fixed id, an empty conversation until someone writes in it. */
  conversationId: ConversationId;
}

export interface FakeProjectsInput {
  readonly projects: readonly SeededProject[];
  readonly timelines: FakeTimelines;
  readonly shots: ReadonlyMap<string, PoolShot>;
  readonly ids: IdMaker;
  readonly renderCount: (projectId: ProjectId) => number;
}

/** A version as seeded: what it captured, of which kind, when. */
export interface SeededVersion {
  readonly timelineId: TimelineId;
  readonly kind: TimelineVersionSummary['kind'];
  readonly label: string | null;
  readonly snapshot: Timeline;
  readonly createdAt: number;
}

export function createFakeProjects(
  events: EventBus,
  input: FakeProjectsInput,
  seeded: readonly SeededVersion[],
) {
  const projects = new Map<ProjectId, StoredProject>(
    input.projects.map((project, index) => [
      project.id,
      {
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: Math.max(project.createdAt, ...project.timelines.map((timeline) => timeline.updatedAt)),
        archivedAt: project.archivedAt,
        conversationId: fakeUlid<'Conversation'>(MAKE_KIND.conversation, index + 1),
      },
    ]),
  );
  const versions = new Map<TimelineId, StoredVersion[]>();
  let n = 0;
  const add = (version: SeededVersion, id?: TimelineVersionId) => {
    const list = versions.get(version.timelineId) ?? [];
    const stored: StoredVersion = {
      summary: {
        id: id ?? fakeUlid<'TimelineVersion'>(MAKE_KIND.version, (n += 1)),
        timelineId: version.timelineId,
        number: (list[list.length - 1]?.summary.number ?? 0) + 1,
        kind: version.kind,
        label: version.label,
        revision: version.snapshot.revision,
        createdAt: version.createdAt,
      },
      snapshot: version.snapshot,
    };
    versions.set(version.timelineId, [...list, stored]);
    return stored;
  };
  for (const version of seeded) add(version);

  const touched = (projectId: ProjectId) => {
    const project = projects.get(projectId);
    if (project) project.updatedAt = Date.now();
    events.emit('library.changed', { projectId, entity: 'project', change: 'updated', ids: [projectId] });
  };
  const findVersion = (timelineId: TimelineId, versionId: TimelineVersionId) =>
    versions.get(timelineId)?.find((version) => version.summary.id === versionId);
  const versionTimeline = (versionId: TimelineVersionId) =>
    [...versions.entries()].find(([, list]) => list.some((version) => version.summary.id === versionId))?.[0];

  function summary(project: StoredProject): ProjectSummary {
    const timelines = input.timelines.listByProject(project.id);
    const newest = [...timelines].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const first = newest
      ? input.timelines.get(newest.id)?.tracks[0]?.items.find((item) => item.type === 'clip')
      : undefined;
    const shot =
      first?.type === 'clip' && first.media.kind === 'video'
        ? input.shots.get(first.media.shotId ?? first.media.assetId)
        : undefined;
    return {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: Math.max(project.updatedAt, newest?.updatedAt ?? 0),
      archivedAt: project.archivedAt,
      timelines: timelines.length,
      renders: input.renderCount(project.id),
      poster: shot?.thumbnail ?? null,
      conversationId: project.conversationId,
    };
  }

  const missingProject = (id: string) => err(NotFoundError({ entity: 'project', id }));
  const base = { sideEffect: 'write' as const, project: (p: { projectId: ProjectId }) => p.projectId };

  const commands: AnyCommand[] = [
    defineCommand({
      ...base,
      name: PROJECT_COMMANDS.rename,
      payload: P[PROJECT_COMMANDS.rename],
      handle: (p) => {
        const project = projects.get(p.projectId);
        if (!project) return missingProject(p.projectId);
        const before = project.name;
        project.name = p.name;
        touched(p.projectId);
        return ok({
          result: null,
          inverse: { name: PROJECT_COMMANDS.rename, payload: { projectId: p.projectId, name: before } },
        });
      },
    }),
    ...(
      [
        [PROJECT_COMMANDS.archive, PROJECT_COMMANDS.unarchive, true],
        [PROJECT_COMMANDS.unarchive, PROJECT_COMMANDS.archive, false],
      ] as const
    ).map(([name, inverse, archived]) =>
      defineCommand({
        ...base,
        name,
        payload: P[name],
        handle: (p) => {
          const project = projects.get(p.projectId);
          if (!project) return missingProject(p.projectId);
          project.archivedAt = archived ? Date.now() : null;
          touched(p.projectId);
          return ok({ result: null, inverse: { name: inverse, payload: { projectId: p.projectId } } });
        },
      }),
    ),
    defineCommand({
      ...base,
      name: PROJECT_COMMANDS.saveVersion,
      payload: P[PROJECT_COMMANDS.saveVersion],
      handle: (p) => {
        const timeline = input.timelines.get(p.timelineId);
        if (!timeline) return err(NotFoundError({ entity: 'timeline', id: p.timelineId }));
        const saved = add(
          {
            timelineId: p.timelineId,
            kind: p.label ? 'named' : 'auto',
            label: p.label ?? null,
            snapshot: timeline,
            createdAt: Date.now(),
          },
          p.versionId,
        );
        touched(p.projectId);
        return ok({
          result: { versionId: saved.summary.id, number: saved.summary.number },
          inverse: {
            name: PROJECT_COMMANDS.deleteVersion,
            payload: { projectId: p.projectId, versionId: saved.summary.id },
          },
        });
      },
    }),
    defineCommand({
      ...base,
      name: PROJECT_COMMANDS.deleteVersion,
      payload: P[PROJECT_COMMANDS.deleteVersion],
      internal: true,
      handle: (p) => {
        const timelineId = versionTimeline(p.versionId);
        const version = timelineId && findVersion(timelineId, p.versionId);
        if (!timelineId || !version)
          return err(NotFoundError({ entity: 'timelineVersion', id: p.versionId }));
        versions.set(
          timelineId,
          versions.get(timelineId)!.filter((item) => item !== version),
        );
        touched(p.projectId);
        return ok({
          result: null,
          inverse: {
            name: PROJECT_COMMANDS.saveVersion,
            payload: {
              projectId: p.projectId,
              timelineId,
              versionId: p.versionId,
              ...(version.summary.label ? { label: version.summary.label } : {}),
            },
          },
        });
      },
    }),
    defineCommand({
      ...base,
      name: PROJECT_COMMANDS.renameVersion,
      payload: P[PROJECT_COMMANDS.renameVersion],
      handle: (p) => {
        const timelineId = versionTimeline(p.versionId);
        const version = timelineId && findVersion(timelineId, p.versionId);
        if (!version) return err(NotFoundError({ entity: 'timelineVersion', id: p.versionId }));
        const before = version.summary.label;
        version.summary = {
          ...version.summary,
          label: p.label,
          kind: p.label ? 'named' : version.summary.kind,
        };
        touched(p.projectId);
        return ok({
          result: null,
          inverse: {
            name: PROJECT_COMMANDS.renameVersion,
            payload: { projectId: p.projectId, versionId: p.versionId, label: before },
          },
        });
      },
    }),
    defineCommand({
      ...base,
      name: PROJECT_COMMANDS.restoreVersion,
      payload: P[PROJECT_COMMANDS.restoreVersion],
      handle: (p) => {
        const current = input.timelines.get(p.timelineId);
        const target = findVersion(p.timelineId, p.versionId);
        if (!current || !target) return err(NotFoundError({ entity: 'timelineVersion', id: p.versionId }));
        // First keep what is there now, so the restore can be undone (redo reuses the snapshot's id).
        const reuse = p.beforeVersionId ? findVersion(p.timelineId, p.beforeVersionId) : undefined;
        const before =
          reuse ??
          add(
            {
              timelineId: p.timelineId,
              kind: 'before-restore',
              label: null,
              snapshot: current,
              createdAt: Date.now(),
            },
            p.beforeVersionId,
          );
        if (reuse) reuse.snapshot = current;
        const { revision: _revision, updatedAt: _updatedAt, ...content } = target.snapshot;
        input.timelines.replace(p.projectId, { ...current, ...content, id: current.id });
        touched(p.projectId);
        return ok({
          result: { timelineId: p.timelineId, restored: target.summary.number },
          inverse: {
            name: PROJECT_COMMANDS.restoreVersion,
            payload: {
              projectId: p.projectId,
              timelineId: p.timelineId,
              versionId: before.summary.id,
              beforeVersionId: p.versionId,
            },
          },
        });
      },
    }),
  ];

  return {
    commands,
    addCreation(id: ProjectId, name: string) {
      projects.set(id, {
        id,
        name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        archivedAt: null,
        conversationId: fakeUlid<'Conversation'>(MAKE_KIND.conversation, projects.size + 1),
      });
      touched(id);
    },
    list(archived: boolean, limit: number) {
      const items = [...projects.values()]
        .filter((project) => (project.archivedAt !== null) === archived)
        .map(summary)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return { items: items.slice(0, limit) };
    },
    get: (projectId: ProjectId) => {
      const project = projects.get(projectId);
      return project ? summary(project) : null;
    },
    versions: (timelineId: TimelineId, limit: number) => ({
      items: [...(versions.get(timelineId) ?? [])]
        .map((version) => version.summary)
        .reverse()
        .slice(0, limit),
    }),
    /** An export keeps the revision it rendered (render SPEC 17). */
    exported(timelineId: TimelineId, label: string) {
      const timeline = input.timelines.get(timelineId);
      if (timeline) add({ timelineId, kind: 'export', label, snapshot: timeline, createdAt: Date.now() });
    },
  };
}

export const SEED_HOURS_AGO = (hours: number) => FIXTURE_NOW - hours * HOUR;

export type FakeProjects = ReturnType<typeof createFakeProjects>;
