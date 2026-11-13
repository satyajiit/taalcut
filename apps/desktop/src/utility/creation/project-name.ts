// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ok, type CommandContext, type CreationProject, type Result } from '@taalcut/core';
import type { CreationCommandKit } from './command-kit';

/** A video-name edit shares the brief's transaction; undo keeps the actual prior project name. */
export function stageCreationProjectName(
  kit: CreationCommandKit,
  context: CommandContext,
  before: CreationProject,
  next: CreationProject,
  restoredName?: string,
): Result<string | undefined> {
  if (restoredName === undefined && before.brief.title === next.brief.title) return ok(undefined);
  const current = kit.projects.get(before.projectId);
  if (!current.ok) return current;
  const name = restoredName ?? next.brief.title;
  if (current.value.name !== name) {
    const staged = kit.stage(context, () => kit.projects.rename(before.projectId, name));
    if (!staged.ok) return staged;
  }
  return ok(current.value.name);
}
