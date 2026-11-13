// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { RunId } from '../basics/ids';
import { err, ok } from '../basics/result';
import { InternalCommand } from './bus-types';
import type { AnyCommand } from './definition';
import { ProjectEditing, type EditingOwnership } from './editing-ownership';

/** Server-only lifecycle dispatch is restricted to a declared cleanup command and the stopping run's project. */
export function admitLifecycle(
  editing: EditingOwnership,
  command: AnyCommand,
  payload: unknown,
  runId: RunId,
) {
  if (!command.lifecycle) return err(InternalCommand({ name: command.name }));
  const projectId = command.project(payload);
  if (!projectId || command.affectedProjects?.(payload).length)
    return err(InternalCommand({ name: command.name }));
  const owner = editing.snapshot(projectId);
  if (owner.phase !== 'idle' && (owner.runId !== runId || owner.phase === 'editing'))
    return err(ProjectEditing({ projectId }));
  return ok(undefined);
}
