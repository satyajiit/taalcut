// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What `library.changed` and a skill's entity refs can name. */
export const LIBRARY_ENTITIES = [
  'project',
  'source',
  'asset',
  'shot',
  'template',
  'timeline',
  'render',
  /** A chat: its title changed (named after its first exchange, or renamed). */
  'conversation',
  /** LRN1-MEM: memory items (Settings → Memory re-reads; the library's memory indexer embeds them). */
  'memory',
  /** LRN1-STY: a set's style profile was built or its summary written (ids: styleSourceKey). */
  'styleProfile',
  /** EDT1-CMT: a timeline's comments (ids: comment ids; the editor's Comments tab follows them by watch). */
  'comment',
] as const;
export type LibraryEntity = (typeof LIBRARY_ENTITIES)[number];
