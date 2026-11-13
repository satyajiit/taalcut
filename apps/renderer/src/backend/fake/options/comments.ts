// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AreaOptionsReader } from './area-options';

/**
 * The editor's comments' fake options from `taalcut.fake` (EDT1-CMT): `comments` 'seeded' puts three comments on the
 * first video with two clips (comments/comments-seed.ts). Anything else: none.
 */
export const commentsOptions: AreaOptionsReader = (stored) =>
  stored['comments'] === 'seeded' ? { phase3: { comments: { scenario: 'seeded' } } } : {};
