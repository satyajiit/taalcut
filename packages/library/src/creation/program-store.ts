// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import {
  AUTHORED_PROGRAM_LIMITS,
  authoredProgramDigestInput,
  authoredProgramSchema,
  err,
  NotFoundError,
  ok,
  sha256Schema,
  ValidationError,
  type AuthoredProgramStore,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { CommandStager } from '../ports/staging';
import { stagedWriter } from '../stores/staged-write';
import { createWorkspaceBlobs } from '../stores/workspace-blobs';

/** The separate root retains full-film source without changing the short graphics workspace's limits. */
export const authoredProgramRoot = (userData: string): string => join(userData, 'authored');

export function createAuthoredProgramStore(
  db: LibraryDatabase,
  options: { readonly dataRoot: string; readonly commands?: CommandStager },
): AuthoredProgramStore {
  const root = authoredProgramRoot(options.dataRoot);
  const blobs = createWorkspaceBlobs(root, AUTHORED_PROGRAM_LIMITS.fileBytes);
  const write = stagedWriter(db, options.commands, 'authoredProgram');
  return {
    async get(projectId, ref) {
      const row = db.driver
        .prepare('SELECT manifest FROM authored_programs WHERE project_id = ? AND id = ? AND hash = ?')
        .get(projectId, ref.id, ref.hash);
      if (!row) return err(NotFoundError({ entity: 'authoredProgram', id: ref.id }));
      try {
        const parsed = authoredProgramSchema.safeParse(JSON.parse(String(row['manifest'])));
        return parsed.success
          ? ok(parsed.data)
          : err(ValidationError({ field: 'program' }, { detail: 'Stored authored program is invalid' }));
      } catch {
        return err(
          ValidationError({ field: 'program' }, { detail: 'Stored authored program is unreadable' }),
        );
      }
    },
    async readFile(projectId, sha256) {
      if (!sha256Schema.safeParse(sha256).success)
        return err(ValidationError({ field: 'sha256' }, { detail: 'Invalid source digest' }));
      return blobs.read(projectId, sha256);
    },
    async putFile(projectId, bytes) {
      if (bytes.byteLength > AUTHORED_PROGRAM_LIMITS.fileBytes)
        return err(
          ValidationError({ field: 'source' }, { detail: 'Authored source exceeds the file limit' }),
        );
      await mkdir(root, { recursive: true });
      return blobs.put(projectId, bytes);
    },
    async save(projectId, program, context) {
      const parsed = authoredProgramSchema.safeParse(program);
      if (!parsed.success)
        return err(ValidationError({ field: 'program' }, { detail: 'Invalid authored program manifest' }));
      const hash = createHash('sha256').update(authoredProgramDigestInput(parsed.data)).digest('hex');
      if (hash !== program.hash)
        return err(
          ValidationError(
            { field: 'hash' },
            { detail: 'Authored program digest does not match its source manifest' },
          ),
        );
      for (const file of program.files) {
        const bytes = await blobs.read(projectId, file.sha256);
        if (!bytes.ok) return bytes;
        if (bytes.value.byteLength !== file.bytes)
          return err(
            ValidationError({ field: 'files' }, { detail: 'Authored program file size does not match' }),
          );
      }
      return write(
        context,
        () => ok(undefined),
        () => {
          db.driver
            .prepare(
              `INSERT OR IGNORE INTO authored_programs(project_id, id, hash, manifest, created_at)
          VALUES (?, ?, ?, ?, ?)`,
            )
            .run(projectId, program.id, program.hash, JSON.stringify(parsed.data), db.clock());
        },
      );
    },
  };
}
