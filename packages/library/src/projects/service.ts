// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The projects read model behind `appContract.projects` (P2-X3): the
 * /projects list (name, last change, timelines, renders, a poster) and a
 * timeline's saved versions. A project's last change is its own or its
 * newest timeline's, whichever is later; the list is newest first, keyset
 * paged on that. The poster is the newest timeline's first clip's thumbnail
 * (a derived-file key, never a path), or null. The project's chat is the
 * first conversation moved into it that isn't deleted (the flow that made
 * the project), or null before anyone wrote in it.
 */
import {
  err,
  NotFoundError,
  ok,
  thumbnailRefSchema,
  ValidationError,
  type AsyncResult,
  type ConversationId,
  type DerivedFileRef,
  type ProjectId,
  type ProjectSummary,
  type Timeline,
  type TimelineId,
  type TimelineVersionSummary,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { SqlRow, SqlValue } from '../driver/types';
import { decodeCursor, encodeCursor } from '../stores/canonical';
import { createTimelineVersions } from '../stores/timeline-versions';

export interface ProjectsService {
  list(input: {
    readonly archived: boolean;
    readonly limit: number;
    readonly cursor?: string;
  }): AsyncResult<{ items: ProjectSummary[]; nextCursor?: string }>;
  get(projectId: ProjectId): AsyncResult<ProjectSummary>;
  versions(input: {
    readonly timelineId: TimelineId;
    readonly limit: number;
    readonly cursor?: string;
  }): AsyncResult<{ items: TimelineVersionSummary[]; nextCursor?: string }>;
}

const LAST_CHANGE = `max(p.updated_at, coalesce((SELECT max(t.updated_at) FROM timelines t WHERE t.project_id = p.id), 0))`;
const SELECT = `SELECT p.id, p.name, p.created_at, p.archived_at, ${LAST_CHANGE} AS last_change,
  (SELECT count(*) FROM timelines t WHERE t.project_id = p.id) AS timelines,
  (SELECT count(*) FROM renders r WHERE r.project_id = p.id AND r.deleted_at IS NULL) AS renders,
  (SELECT c.id FROM conversations c WHERE c.project_id = p.id AND c.deleted_at IS NULL
    ORDER BY c.created_at, c.id LIMIT 1) AS conversation_id
  FROM projects p`;

export function createProjectsService(db: LibraryDatabase): ProjectsService {
  const versions = createTimelineVersions(db);

  /** The thumbnail of the newest timeline's first V1 clip: its shot's own, else the asset's. */
  function poster(projectId: string): DerivedFileRef | null {
    const newest = db.driver
      .prepare(
        'SELECT document FROM timelines WHERE project_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1',
      )
      .get(projectId);
    if (!newest) return null;
    const document = JSON.parse(String(newest.document)) as Partial<Timeline>;
    const video = document.tracks?.find((track) => track.kind === 'video');
    const clip = video?.items.find((item) => item.type === 'clip');
    if (!clip || clip.type !== 'clip') return null;
    const shotId = clip.media.kind === 'video' ? clip.media.shotId : null;
    const row = db.driver
      .prepare(
        `SELECT * FROM derived_files WHERE asset_id = ? AND kind = 'thumbnail' AND mime_type = 'image/jpeg'
         ORDER BY (shot_id IS ?) DESC, (shot_id IS NULL) DESC, created_at DESC LIMIT 1`,
      )
      .get(clip.media.assetId, shotId);
    return row ? toThumbnail(row) : null;
  }

  function summary(row: SqlRow): ProjectSummary {
    return {
      id: String(row.id) as ProjectId,
      name: String(row.name),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.last_change),
      archivedAt: row.archived_at === null ? null : Number(row.archived_at),
      timelines: Number(row.timelines),
      renders: Number(row.renders),
      poster: poster(String(row.id)),
      conversationId: row.conversation_id === null ? null : (String(row.conversation_id) as ConversationId),
    };
  }

  return {
    async list({ archived, limit, cursor }) {
      const where = [archived ? 'p.archived_at IS NOT NULL' : 'p.archived_at IS NULL'];
      const params: SqlValue[] = [];
      if (cursor !== undefined) {
        const after = decodeCursor(cursor);
        if (!after) return err(ValidationError({ field: 'cursor' }));
        where.push(`(${LAST_CHANGE} < ? OR (${LAST_CHANGE} = ? AND p.id < ?))`);
        params.push(after.at, after.at, after.id);
      }
      const rows = db.driver
        .prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY last_change DESC, p.id DESC LIMIT ?`)
        .all(...params, limit + 1);
      const items = rows.slice(0, limit).map(summary);
      const last = items.at(-1);
      return ok({
        items,
        ...(rows.length > limit && last ? { nextCursor: encodeCursor(last.updatedAt, last.id) } : {}),
      });
    },
    async get(projectId) {
      const row = db.driver.prepare(`${SELECT} WHERE p.id = ?`).get(projectId);
      return row ? ok(summary(row)) : err(NotFoundError({ entity: 'project', id: projectId }));
    },
    async versions({ timelineId, limit, cursor }) {
      const exists = db.driver.prepare('SELECT 1 AS one FROM timelines WHERE id = ?').get(timelineId);
      if (!exists) return err(NotFoundError({ entity: 'timeline', id: timelineId }));
      return versions.list(timelineId, { limit, ...(cursor !== undefined ? { cursor } : {}) });
    },
  };
}

function toThumbnail(row: SqlRow): DerivedFileRef | null {
  const optional = <T>(present: boolean, value: () => T) => (present ? value() : undefined);
  const candidate = {
    kind: row.kind,
    key: row.key,
    bytes: row.bytes,
    mimeType: row.mime_type,
    width: optional(row.width !== null, () => row.width),
    height: optional(row.height !== null, () => row.height),
    duration: optional(row.duration_value !== null, () => ({
      value: row.duration_value,
      rate: { num: row.duration_rate_num, den: row.duration_rate_den },
    })),
    frameRate: optional(row.frame_rate_num !== null, () => ({
      num: row.frame_rate_num,
      den: row.frame_rate_den,
    })),
    recipe: row.recipe,
  };
  const parsed = thumbnailRefSchema.safeParse(JSON.parse(JSON.stringify(candidate)));
  return parsed.success ? parsed.data : null;
}
