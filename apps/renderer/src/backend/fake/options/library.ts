// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AreaOptionsReader } from './area-options';

/** Most templates the fake's library makes up (the contract lists 200 a page). */
const MAX_TEMPLATES = 2000;

/**
 * The template library's fake options from `taalcut.fake` (P3-V14): `templates: 200` gives a library of that many
 * templates, with folders, tags, favourites, trend dates and provenance (`templates: 'empty'` is Phase 2's).
 */
export const libraryOptions: AreaOptionsReader = (stored) => {
  const count = stored['templates'];
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return {};
  return { phase2: { templates: { count: Math.min(count, MAX_TEMPLATES) } } };
};
