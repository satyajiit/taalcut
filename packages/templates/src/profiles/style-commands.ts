// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `styleProfile.use` (LRN1-STY): the project is made like a set of references, so the Editor follows its style and
 * QA's stylePacing checks the project's renders against its pacing band. Undoable: the inverse puts back the set the
 * project had (or none). The person can dispatch it, and the agent does when asked to make a video "like my saved X".
 */
import {
  defineCommand,
  ok,
  STYLE_PROFILE_COMMANDS,
  styleProfileCommandPayloads,
  type AnyCommand,
  type StyleProfileStore,
} from '@taalcut/core';

const N = STYLE_PROFILE_COMMANDS;
const P = styleProfileCommandPayloads;

export function createStyleProfileCommands(deps: {
  readonly store: Pick<StyleProfileStore, 'projectStyle' | 'setProjectStyle'>;
}) {
  const use = defineCommand({
    name: N.use,
    payload: P[N.use],
    sideEffect: 'write',
    handle: async ({ projectId, source }, context) => {
      const before = await deps.store.projectStyle(projectId);
      if (!before.ok) return before;
      const set = await deps.store.setProjectStyle(projectId, source, context);
      if (!set.ok) return set;
      return ok({
        result: { projectId, source },
        inverse: { name: N.use, payload: { projectId, source: before.value } },
      });
    },
  });
  const all: AnyCommand[] = [use];
  return { use, all };
}
