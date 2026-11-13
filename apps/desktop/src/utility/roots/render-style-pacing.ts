// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The render engine's `stylePacing` port (LRN1-STY): the pacing band of the set a render's project is made like
 * (`styleProfile.use`), read from the library's stored style profiles. The agent rebuilds a stale profile whenever
 * the Editor reads it, before a draft renders; a project that follows no set, or a set without a profile, gives
 * null and QA skips stylePacing.
 */
import { ok, type Container } from '@taalcut/core';
import { createStyleProfileStore } from '@taalcut/library';
import type { RenderEngineDeps } from '@taalcut/render';
import { LibraryDatabaseToken } from '../../shared/tokens';

export function renderStylePacing(container: Container): Pick<RenderEngineDeps, 'stylePacing'> {
  if (!container.has(LibraryDatabaseToken)) return {};
  return {
    stylePacing: async (projectId) => {
      const store = createStyleProfileStore(container.resolve(LibraryDatabaseToken));
      const followed = await store.projectStyle(projectId);
      if (!followed.ok || !followed.value) return followed.ok ? ok(null) : followed;
      const record = await store.get(followed.value);
      return record.ok ? ok(record.value?.profile?.pacing.shot ?? null) : record;
    },
  };
}
