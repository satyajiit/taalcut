// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stored style profiles (LRN1-STY): @taalcut/library implements the store (migration 31) and resolves a set's
 * members from its own tables; @taalcut/templates builds, refreshes and serves profiles in the agent process; the
 * render process reads a project's band for the stylePacing QA check. Profiles are derived data: rebuilt when the
 * digest of the set's member versions changes, and safe to clear. A project's style (`styleProfile.use`) is the
 * person's choice and goes through the command bus.
 */
import '../basics/zod-config';
import { z } from 'zod';
import type { ProjectId } from '../basics/ids';
import { idSchema } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import type { CommandContext } from '../commands/definition';
import { createToken } from '../di/token';
import type { TemplateRef } from './template-schema';
import {
  styleSourceSchema,
  type StyleProfile,
  type StyleSource,
  type StyleProfileSummary,
} from './style-profile';

export interface StyleProfileRecord {
  readonly source: StyleSource;
  /** sha256 of the algorithm, the member refs and the template index name (canonical JSON). */
  readonly digest: string;
  /** Null when the set has no member. */
  readonly profile: StyleProfile | null;
  readonly summary: StyleProfileSummary;
  readonly builtAt: number;
}

export interface StyleProfileStamp {
  readonly source: StyleSource;
  readonly digest: string;
}

export interface StyleProfileStore {
  /**
   * The set's members: unarchived templates at their heads, the newest STYLE_PROFILE_MAX_MEMBERS, in id order.
   * core.not_found when the collection or folder is gone.
   */
  members(source: StyleSource): AsyncResult<TemplateRef[]>;
  /** The collection's or folder's name, the tag, or null for my exports. core.not_found when gone. */
  sourceName(source: StyleSource): AsyncResult<string | null>;
  get(source: StyleSource): AsyncResult<StyleProfileRecord | null>;
  /** Every stored profile's set and digest (what the refresher checks). */
  list(): AsyncResult<StyleProfileStamp[]>;
  /** Replaces the set's profile. */
  put(record: StyleProfileRecord): AsyncResult<void>;
  /** The summary of the stored profile with this digest; false (nothing written) when it was rebuilt meanwhile. */
  setSummary(source: StyleSource, digest: string, summary: StyleProfileSummary): AsyncResult<boolean>;
  remove(source: StyleSource): AsyncResult<void>;
  /** The set a project is made like; null when none. */
  projectStyle(projectId: ProjectId): AsyncResult<StyleSource | null>;
  /** Staged with the command (styleProfile.use). core.not_found when the project is gone. */
  setProjectStyle(
    projectId: ProjectId,
    source: StyleSource | null,
    context?: CommandContext,
  ): AsyncResult<void>;
}

export const StyleProfileStoreToken = createToken<StyleProfileStore>('core.styleProfileStore');

export const STYLE_PROFILE_COMMANDS = {
  /**
   * write: the project is made like this set (null: like none). The Editor follows its style, and QA's stylePacing
   * checks the project's renders against its pacing band. Inverse: the same command with the previous set.
   */
  use: 'styleProfile.use',
} as const;

export const styleProfileCommandPayloads = {
  [STYLE_PROFILE_COMMANDS.use]: z.object({
    projectId: idSchema<'Project'>(),
    source: styleSourceSchema.nullable(),
  }),
};
