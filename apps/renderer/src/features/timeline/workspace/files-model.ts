// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-UI: the files viewer's view of a timeline, pure. The designs its graphics are drawn with (each copy once, in
 * the order they first play), which design a graphic has, and a list of files grouped by folder for the file list
 * (a folder's files under it, folders by name, then the files at the top).
 */
import type { GraphicComposition, Timeline, TimelineItemId, WorkspaceFile } from '@taalcut/core';

export interface DesignOnTimeline {
  /** `id@hash`: one design version. */
  readonly key: string;
  readonly composition: GraphicComposition;
  /** The graphics drawn with it, by when they play. */
  readonly itemIds: readonly TimelineItemId[];
}

export const designKey = (ref: { readonly id: string; readonly hash: string }) => `${ref.id}@${ref.hash}`;

/** The designs the timeline's graphics are drawn with, in the order they first play. */
export function designsOn(timeline: Pick<Timeline, 'tracks' | 'graphicCompositions'>): DesignOnTimeline[] {
  const copies = new Map((timeline.graphicCompositions ?? []).map((copy) => [designKey(copy), copy]));
  const uses: { key: string; start: number; itemId: TimelineItemId }[] = [];
  for (const track of timeline.tracks) {
    if (track.kind !== 'text') continue;
    for (const item of track.items) {
      if (item.type !== 'graphic' || !item.composition) continue;
      const key = designKey(item.composition);
      if (copies.has(key)) uses.push({ key, start: item.start.value, itemId: item.id });
    }
  }
  uses.sort((a, b) => a.start - b.start);
  const designs = new Map<string, { composition: GraphicComposition; itemIds: TimelineItemId[] }>();
  for (const use of uses) {
    const found = designs.get(use.key);
    if (found) found.itemIds.push(use.itemId);
    else designs.set(use.key, { composition: copies.get(use.key)!, itemIds: [use.itemId] });
  }
  return [...designs].map(([key, design]) => ({ key, ...design }));
}

/** The design a graphic is drawn with, among the timeline's; null for a kit graphic or one not on it. */
export function designOfItem(
  designs: readonly DesignOnTimeline[],
  itemId: string | null,
): DesignOnTimeline | null {
  if (!itemId) return null;
  return designs.find((design) => design.itemIds.includes(itemId as TimelineItemId)) ?? null;
}

export interface FileGroup {
  /** The folder ('' for the files at the top). */
  readonly folder: string;
  readonly files: readonly (WorkspaceFile & { readonly name: string })[];
}

/** Files by folder: each folder's files by name, folders by name, the top's files last. */
export function fileGroups(files: readonly WorkspaceFile[]): FileGroup[] {
  const groups = new Map<string, (WorkspaceFile & { name: string })[]>();
  for (const file of files) {
    const cut = file.path.lastIndexOf('/');
    const folder = cut < 0 ? '' : file.path.slice(0, cut);
    const name = cut < 0 ? file.path : file.path.slice(cut + 1);
    groups.set(folder, [...(groups.get(folder) ?? []), { ...file, name }]);
  }
  return [...groups]
    .map(([folder, list]) => ({
      folder,
      files: list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    }))
    .sort((a, b) => (a.folder === '' ? 1 : b.folder === '' ? -1 : a.folder < b.folder ? -1 : 1));
}

/** The paths in the order the list shows them. */
export const listedPaths = (groups: readonly FileGroup[]) =>
  groups.flatMap((group) => group.files.map((file) => file.path));

/** A file the viewer opens first: the design's entry, else the first listed. */
export function firstFile(groups: readonly FileGroup[], entry: string | null): string | null {
  const paths = listedPaths(groups);
  return entry && paths.includes(entry) ? entry : (paths[0] ?? null);
}
