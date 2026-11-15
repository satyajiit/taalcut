// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AreaOptionsReader } from './area-options';

/**
 * MORE1: the More tab's fake option from `taalcut.fake`: `{ "more": "commands" }` makes the fake run the three
 * edits its tiles end in (make/fake-more.ts: a size copy, a frozen moment, a hold's length), so the held scene and
 * the copy that is ready can be reached in a browser. Off by default: without it the fake refuses them as it
 * always has, which is how the specs see a refusal said beside the control.
 */
export const moreOptions: AreaOptionsReader = (stored) =>
  stored['more'] === 'commands' ? { make: { areas: { more: 'commands' } } } : {};
