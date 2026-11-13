// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ProjectId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import type { CommandContext } from '../commands/definition';
import { createToken } from '../di/token';
import type { AuthoredProgram, AuthoredProgramRef } from './authored-program';
import type { CreationProject } from './creation-types';

export interface CreationStore {
  get(projectId: ProjectId): AsyncResult<CreationProject>;
  list(): AsyncResult<readonly CreationProject[]>;
  /** Zero creates. A context joins the existing command transaction; stale revisions fail. */
  save(project: CreationProject, expectedRevision: number, context?: CommandContext): AsyncResult<void>;
}
export const CreationStoreToken = createToken<CreationStore>('core.creationStore');

/** Bundle bytes live outside the small graphics workspace; immutable hashes also pin saved timeline versions. */
export interface AuthoredProgramStore {
  get(projectId: ProjectId, ref: AuthoredProgramRef): AsyncResult<AuthoredProgram>;
  readFile(projectId: ProjectId, sha256: string): AsyncResult<Uint8Array>;
  putFile(projectId: ProjectId, bytes: Uint8Array): AsyncResult<{ sha256: string; bytes: number }>;
  save(projectId: ProjectId, program: AuthoredProgram, context?: CommandContext): AsyncResult<void>;
}
export const AuthoredProgramStoreToken = createToken<AuthoredProgramStore>('core.authoredProgramStore');
