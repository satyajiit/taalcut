// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1: a made timeline's compositions get their files. A template keeps its compositions' files in the templates'
 * pool, apart from any project; render draws a timeline's from its own project's workspace. So before the timelines
 * are created, every file their copies name goes from the pool into the project (`putBlob`, once per sha256), and
 * the project's prune keeps them while a copy names them. A composition whose files can't all be put is left out,
 * with the graphics it draws: there is no other design to draw them with.
 */
import { type GraphicComposition, type ProjectId, type Timeline, type WorkspaceStore } from '@taalcut/core';

export type CompositionFiles = Pick<WorkspaceStore, 'putBlob' | 'readTemplateBlob'>;

export interface FilledTimelines {
  readonly timelines: Timeline[];
  /** Why compositions were left out, in plain words. */
  readonly warnings: string[];
}

async function copied(store: CompositionFiles, projectId: ProjectId, composition: GraphicComposition) {
  if (!store.readTemplateBlob) return false;
  for (const file of composition.files) {
    const data = await store.readTemplateBlob(file.sha256);
    if (!data.ok) return false;
    const put = await store.putBlob(projectId, data.value);
    if (!put.ok || put.value.sha256 !== file.sha256) return false;
  }
  return true;
}

/** The timelines with every composition's files in the project; one that couldn't be copied left out. */
export async function withCompositionFiles(
  store: CompositionFiles | undefined,
  projectId: ProjectId,
  timelines: readonly Timeline[],
): Promise<FilledTimelines> {
  const warnings: string[] = [];
  const done = new Map<string, boolean>();
  const out: Timeline[] = [];
  for (const timeline of timelines) {
    const copies = timeline.graphicCompositions ?? [];
    if (copies.length === 0) {
      out.push(timeline);
      continue;
    }
    const kept: GraphicComposition[] = [];
    for (const copy of copies) {
      const key = `${copy.id}@${copy.hash}`;
      if (!done.has(key)) done.set(key, store ? await copied(store, projectId, copy) : false);
      if (done.get(key)) kept.push(copy);
      else
        warnings.push(
          `${copy.name}: its files could not be put into the project, so its graphics are left out`,
        );
    }
    const ok = new Set(kept.map((copy) => `${copy.id}@${copy.hash}`));
    const drawn = (item: Timeline['tracks'][number]['items'][number]) =>
      item.type !== 'graphic' || ok.has(`${item.composition.id}@${item.composition.hash}`);
    const { graphicCompositions: _copies, ...rest } = timeline;
    out.push({
      ...rest,
      tracks: timeline.tracks.map((track) =>
        track.kind === 'text' ? { ...track, items: track.items.filter(drawn) } : track,
      ) as Timeline['tracks'],
      ...(kept.length > 0 ? { graphicCompositions: kept } : {}),
    });
  }
  return { timelines: out, warnings: [...new Set(warnings)] };
}
