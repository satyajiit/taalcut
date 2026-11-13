// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';
import { AREAS, isUnder } from '../shell/areas';
import { SETTINGS_SECTIONS } from '../shell/settings-sections';

/**
 * The shape a page's bones take while its code loads, so the page lands where its bones were:
 * - rows: the Page frame's description, then a section of hairline rows (Settings, Make, Templates, details)
 * - grid: the library's search field, its filter chips and a grid of tiles
 * - editor: the editor's viewer, inspector and tracks, edge to edge
 * - chat: a new chat's centred column, its first line and the composer
 */
export type PageShape = 'rows' | 'grid' | 'editor' | 'chat';

/** Where a pending page is going: its bones' shape, and its name for the window bar when that is known. */
export interface PagePlace {
  readonly shape: PageShape;
  /** The page's name (an area's or a Settings section's), or null where only the page itself knows it. */
  readonly title: MessageDescriptor | null;
  /** A page inside the area (a clip, a project): its name comes after the title's chevron, as a bone. */
  readonly detail: boolean;
}

const EDITOR = /^\/projects\/[^/]+\/timeline\/?$/;

/**
 * A Settings section's own pages: its `to`, and the pages its row stands for (`also`: General for Updates, This Mac
 * and About, UX4's set lane), matched as the settings route matches them (set-requests §7). Read loosely, so this
 * works before and after sections carry `also`.
 */
function pagesOf(section: { readonly to: unknown }): string[] {
  const also = (section as { readonly also?: readonly string[] }).also ?? [];
  return typeof section.to === 'string' ? [section.to, ...also] : [...also];
}

/** What the page at `pathname` will look like, as far as the shell knows before its code arrives. */
export function pagePlace(pathname: string): PagePlace {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const section = SETTINGS_SECTIONS.find((s) => isUnder(path, pagesOf(s)));
  if (section) return { shape: 'rows', title: section.label, detail: !pagesOf(section).includes(path) };
  const area = AREAS.find((a) => isUnder(path, a.paths));
  if (!area) return { shape: 'rows', title: null, detail: false };
  const home = path === area.to;
  if (EDITOR.test(path)) return { shape: 'editor', title: area.label, detail: true };
  if (area.id === 'library' && home) return { shape: 'grid', title: area.label, detail: false };
  if (area.id === 'agent' && home) return { shape: 'chat', title: area.label, detail: false };
  return { shape: 'rows', title: area.label, detail: !home };
}
