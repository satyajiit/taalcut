// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** HFW1: the compile's workspace reader for a timeline's project, when the engine knows where workspaces are. */
import type { CompileOptions } from '../../compile/compile-options';
import { join } from 'node:path';
import { AUTHORED_PROGRAM_LIMITS } from '@taalcut/core';
import { workspaceReaderAt } from './reader';

export const workspaceOf = (
  root: string | undefined,
  projectId: string,
): Pick<CompileOptions, 'workspace' | 'authoredWorkspace'> =>
  root
    ? {
        workspace: workspaceReaderAt(root, projectId),
        authoredWorkspace: workspaceReaderAt(
          join(root, 'authored'),
          projectId,
          AUTHORED_PROGRAM_LIMITS.fileBytes,
          true,
        ),
      }
    : {};
