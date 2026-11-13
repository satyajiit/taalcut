// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Projects and saved timeline versions (P2-X3): command names and payloads
 * (handlers in @taalcut/library) and `appContract.projects`, owner agent
 * (projectsRouter). Timelines themselves are the timeline lane's
 * (`timelines.*`, TimelineStore).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { thumbnailRefSchema } from '../analysis/media-facts';
import { idSchema } from '../basics/ids';
import { ipc } from '../ipc/contract';

export const PROJECT_COMMANDS = {
  create: 'project.create',
  rename: 'project.rename',
  archive: 'project.archive',
  unarchive: 'project.unarchive',
  saveVersion: 'project.saveVersion',
  renameVersion: 'project.renameVersion',
  /** internal: saveVersion's inverse. */
  deleteVersion: 'project.deleteVersion',
  /** Undoable: its inverse restores the before-restore snapshot it takes. */
  restoreVersion: 'project.restoreVersion',
} as const;

const projectId = idSchema<'Project'>();
const timelineId = idSchema<'Timeline'>();
const versionId = idSchema<'TimelineVersion'>();
const name = z.string().trim().min(1).max(200);
const versionLabel = z.string().trim().min(1).max(100);

export const projectCommandPayloads = {
  [PROJECT_COMMANDS.create]: z.object({ name, projectId: projectId.optional() }),
  [PROJECT_COMMANDS.rename]: z.object({
    projectId,
    name,
    /** Automatic naming must not overwrite a name changed while the title was being generated. */
    expectedName: name.optional(),
    /** Adopt the owning conversation's title only while the project name is still app-managed. */
    fromConversation: idSchema<'Conversation'>().optional(),
  }),
  [PROJECT_COMMANDS.archive]: z.object({ projectId }),
  [PROJECT_COMMANDS.unarchive]: z.object({ projectId }),
  [PROJECT_COMMANDS.saveVersion]: z.object({
    projectId,
    timelineId,
    label: versionLabel.optional(),
    versionId: versionId.optional(),
  }),
  [PROJECT_COMMANDS.renameVersion]: z.object({ projectId, versionId, label: versionLabel.nullable() }),
  [PROJECT_COMMANDS.deleteVersion]: z.object({ projectId, versionId }),
  [PROJECT_COMMANDS.restoreVersion]: z.object({
    projectId,
    timelineId,
    versionId,
    /** Set by redo so the snapshot keeps its id. */
    beforeVersionId: versionId.optional(),
  }),
};

export const TIMELINE_VERSION_KINDS = ['auto', 'named', 'before-restore', 'export'] as const;
const epochMs = z.int().nonnegative();

export const projectSummarySchema = z.object({
  id: projectId,
  name: z.string(),
  createdAt: epochMs,
  updatedAt: epochMs,
  archivedAt: epochMs.nullable(),
  timelines: z.int().nonnegative(),
  renders: z.int().nonnegative(),
  /** A frame of the newest timeline's first clip. */
  poster: thumbnailRefSchema.nullable(),
  /** The project's chat: its runs, and the editor's docked chat. Null before the first message. */
  conversationId: idSchema<'Conversation'>().nullable(),
});
export type ProjectSummary = z.output<typeof projectSummarySchema>;

export const timelineVersionSummarySchema = z.object({
  id: versionId,
  timelineId,
  number: z.int().positive(),
  kind: z.enum(TIMELINE_VERSION_KINDS),
  label: z.string().nullable(),
  /** The timeline revision it captured (a render's timelineRevision). */
  revision: z.int().positive(),
  createdAt: epochMs,
});
export type TimelineVersionSummary = z.output<typeof timelineVersionSummarySchema>;

const page = { limit: z.int().min(1).max(200).default(50), cursor: z.string().max(200).optional() };

export const projectsContract = {
  list: ipc
    .input(z.object({ archived: z.boolean().default(false), ...page }))
    .output(z.object({ items: z.array(projectSummarySchema), nextCursor: z.string().optional() })),
  get: ipc.input(z.object({ projectId })).output(projectSummarySchema),
  versions: ipc
    .input(z.object({ timelineId, ...page }))
    .output(z.object({ items: z.array(timelineVersionSummarySchema), nextCursor: z.string().optional() })),
};
