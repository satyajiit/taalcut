// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Saved-version commands (P2-X3): saveVersion (inverse: the internal
 * deleteVersion), renameVersion, and restoreVersion, which is itself
 * undoable.
 *
 * Restore puts the chosen version's document back as the working copy (a
 * new revision). First it makes sure the working copy is kept: if no version
 * holds that document yet it is saved as `before-restore`; its inverse
 * restores that version. Undo and redo find the document they leave already
 * held by a version, so going back and forth never piles up snapshots.
 */
import {
  err,
  newId,
  NotFoundError,
  ok,
  PROJECT_COMMANDS,
  projectCommandPayloads,
  ValidationError,
  defineCommand,
  type ProjectId,
  type Result,
  type TimelineId,
  type TimelineVersionId,
} from '@taalcut/core';
import { asTimeline } from '../stores/timeline-store';
import { documentHash } from '../stores/timeline-rows';
import type { ProjectCommandKit } from './kit';

export function createVersionCommands(kit: ProjectCommandKit) {
  const { timelines } = kit.deps;
  const { versions } = timelines;

  /** The timeline, if it is the project's. */
  async function timelineOf(projectId: ProjectId, timelineId: TimelineId) {
    const stored = await timelines.get(timelineId);
    if (!stored.ok) return stored;
    return stored.value.summary.projectId === projectId
      ? stored
      : err(NotFoundError({ entity: 'timeline', id: timelineId }));
  }

  /** The version, if it belongs to a timeline of the project. */
  async function versionOf(projectId: ProjectId, versionId: TimelineVersionId) {
    const version = versions.get(versionId);
    if (!version.ok) return version;
    const owner = await timelineOf(projectId, version.value.summary.timelineId);
    return owner.ok ? version : err(NotFoundError({ entity: 'timeline_version', id: versionId }));
  }

  const timelineChange = (projectId: ProjectId, timelineId: TimelineId) =>
    ({ projectId, entity: 'timeline', change: 'updated', ids: [timelineId] }) as const;

  const saveVersion = defineCommand({
    name: PROJECT_COMMANDS.saveVersion,
    payload: projectCommandPayloads[PROJECT_COMMANDS.saveVersion],
    sideEffect: 'write',
    handle: kit.handle(async ({ projectId, timelineId, label, versionId }, context) => {
      const owner = await timelineOf(projectId, timelineId);
      if (!owner.ok) return owner;
      const id = versionId ?? (context.commandId as string as TimelineVersionId);
      const staged = kit.stage(context, () =>
        versions.snapshot({
          timelineId,
          kind: 'named',
          label: label ?? null,
          id,
          commandId: context.commandId,
        }),
      );
      if (!staged.ok) return staged;
      kit.note(context, timelineChange(projectId, timelineId));
      return ok({
        result: { versionId: id, timelineId, revision: owner.value.summary.revision },
        inverse: { name: PROJECT_COMMANDS.deleteVersion, payload: { projectId, versionId: id } },
      });
    }),
  });

  const deleteVersion = defineCommand({
    name: PROJECT_COMMANDS.deleteVersion,
    payload: projectCommandPayloads[PROJECT_COMMANDS.deleteVersion],
    sideEffect: 'write',
    internal: true,
    handle: kit.handle(async ({ projectId, versionId }, context) => {
      const version = await versionOf(projectId, versionId);
      // Already gone: also the bus's rollback of a save that never committed.
      if (!version.ok) return NotFoundError.is(version.error) ? ok({ result: { versionId } }) : version;
      const staged = kit.stage(context, () => versions.remove(versionId));
      if (!staged.ok) return staged;
      kit.note(context, timelineChange(projectId, version.value.summary.timelineId));
      return ok({ result: { versionId } });
    }),
  });

  const renameVersion = defineCommand({
    name: PROJECT_COMMANDS.renameVersion,
    payload: projectCommandPayloads[PROJECT_COMMANDS.renameVersion],
    sideEffect: 'write',
    handle: kit.handle(async ({ projectId, versionId, label }, context) => {
      const version = await versionOf(projectId, versionId);
      if (!version.ok) return version;
      const staged = kit.stage(context, () => versions.rename(versionId, label));
      if (!staged.ok) return staged;
      kit.note(context, timelineChange(projectId, version.value.summary.timelineId));
      return ok({
        result: { versionId, label },
        inverse: {
          name: PROJECT_COMMANDS.renameVersion,
          payload: { projectId, versionId, label: version.value.summary.label },
        },
      });
    }),
  });

  /** The id the before-restore snapshot gets: the payload's, else the command's (unless a version has it). */
  function snapshotId(payloadId: TimelineVersionId | undefined, commandId: string): TimelineVersionId {
    if (payloadId) return payloadId;
    const derived = commandId as TimelineVersionId;
    return versions.get(derived).ok ? newId<'TimelineVersion'>() : derived;
  }

  const restoreVersion = defineCommand({
    name: PROJECT_COMMANDS.restoreVersion,
    payload: projectCommandPayloads[PROJECT_COMMANDS.restoreVersion],
    sideEffect: 'write',
    handle: kit.handle(async ({ projectId, timelineId, versionId, beforeVersionId }, context) => {
      const owner = await timelineOf(projectId, timelineId);
      if (!owner.ok) return owner;
      const target = versions.get(versionId);
      if (!target.ok) return target;
      if (target.value.summary.timelineId !== timelineId)
        return err(ValidationError({ field: 'versionId' }, { detail: 'a version of another timeline' }));
      const document = asTimeline(target.value.json, target.value.schemaVersion);
      if (!document.ok) return document;
      const current = owner.value.summary.revision;
      const currentHash = documentHash(owner.value.json);
      const result = {
        timelineId,
        versionId,
        revision: current,
        beforeVersionId: null as TimelineVersionId | null,
      };
      if (currentHash === target.value.documentHash) return ok({ result }); // nothing to restore

      // Keep the working copy first, unless a version already holds it.
      const held = versions.findByHash(timelineId, currentHash);
      const before = held?.id ?? snapshotId(beforeVersionId, context.commandId);
      if (!held) {
        const kept = kit.stage(context, () =>
          versions.snapshot({ timelineId, kind: 'before-restore', id: before, commandId: context.commandId }),
        );
        if (!kept.ok) return kept;
      }
      const restored = {
        ...document.value,
        id: timelineId,
        revision: current + 1,
        updatedAt: (kit.deps.clock ?? Date.now)(),
      };
      const put: Result<unknown> = await timelines.put(restored, current, context);
      if (!put.ok) return put;
      kit.note(context, timelineChange(projectId, timelineId));
      return ok({
        result: { ...result, revision: current + 1, beforeVersionId: before },
        inverse: {
          name: PROJECT_COMMANDS.restoreVersion,
          payload: { projectId, timelineId, versionId: before },
        },
      });
    }),
  });

  return {
    saveVersion,
    deleteVersion,
    renameVersion,
    restoreVersion,
    all: [saveVersion, deleteVersion, renameVersion, restoreVersion],
  };
}
