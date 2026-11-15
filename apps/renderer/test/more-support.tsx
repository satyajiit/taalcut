// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MORE1's tests share this: the seeded timeline behind the More gallery, with a scene changed before it is drawn
 * (a speed, a look, a lock), the gallery mounted as the editor mounts it, and the tiles found by what they are.
 * Commands are checked against the contracts the command queue admits (simple-editor-support.tsx).
 */
import {
  editorCommandPayloads,
  ok,
  simpleEditorPayloads,
  type Clip,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import { vi } from 'vitest';
import { MoreGallery, type MoreGalleryProps } from '../src/features/timeline/more/more-gallery';
import { buildModel } from '../src/features/timeline/model';
import type { EditorSelection } from '../src/features/timeline/selection';
import type { Edits } from '../src/features/timeline/use-edits';
import { fakeLookup } from './other-shots-support';
import { editorFixture, mountEditorControl } from './simple-editor-support';

export interface MoreFixtureOptions {
  /** Which scene is selected: 0 is the video's first; null for none. The third by default. */
  scene?: number | null;
  /** Changes the selected scene before the model is built. */
  patch?: (clip: Clip) => Clip;
  /** Changes the timeline before the model is built (a transition, a cover). */
  timeline?: (timeline: Timeline) => Timeline;
  edits?: Partial<Edits>;
}

export function moreFixture(options: MoreFixtureOptions = {}) {
  const base = editorFixture();
  const index = options.scene === undefined ? 2 : options.scene;
  let scene = -1;
  const patched: Timeline = {
    ...base.timeline,
    tracks: base.timeline.tracks.map((track, trackIndex) =>
      trackIndex !== 0 || track.kind !== 'video'
        ? track
        : {
            ...track,
            items: track.items.map((item) => {
              if (item.type !== 'clip') return item;
              scene += 1;
              return scene === index && options.patch ? options.patch(item) : item;
            }),
          },
    ),
  };
  const timeline = options.timeline ? options.timeline(patched) : patched;
  const model = buildModel(timeline, null);
  const clip = index === null ? undefined : model.clips[index];
  // Commands as the queue admits them: a payload the contract refuses fails the test.
  const command = vi.fn<Edits['command']>(async (name, payload) => {
    const schema =
      simpleEditorPayloads[name as keyof typeof simpleEditorPayloads] ??
      editorCommandPayloads[name as keyof typeof editorCommandPayloads];
    schema?.parse({
      projectId: timeline.projectId,
      timelineId: timeline.id,
      revision: timeline.revision,
      ...payload,
    });
    return ok({});
  });
  const edits: Edits = { ...base.edits, command, ...options.edits };
  const selection: EditorSelection = clip ? { kind: 'clip', clipId: clip.item.id } : null;
  const props: MoreGalleryProps = {
    timeline,
    model,
    selection,
    playhead: base.playhead,
    edits,
    lookup: fakeLookup(),
    onSelect: vi.fn(),
    onAddToChat: vi.fn(),
    onCover: vi.fn(),
    onVideo: vi.fn<(id: TimelineId) => void>(),
    onScenes: vi.fn(),
  };
  return { ...base, timeline, model, clip, command, edits, props };
}

export type MoreFixture = ReturnType<typeof moreFixture>;

/** The gallery as the editor's lower panel mounts it. */
export function mountGallery(fixture: MoreFixture, patch: Partial<MoreGalleryProps> = {}) {
  return mountEditorControl(<MoreGallery {...fixture.props} {...patch} />);
}

/** A tile by what it is: speed, transition, freeze, colour, why, cover, size. */
export function tile(name: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`[data-slot=more-tile][data-tile=${name}]`);
  if (!found) throw new Error(`no ${name} tile`);
  return found;
}

/** What a tile says under its name. */
export const tileValue = (name: string) =>
  tile(name).querySelector('[data-slot=more-tile-value]')?.textContent ?? '';

/** A choice card by its group and value. */
export function card(slot: string, value: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(
    `[data-slot=${slot}] [role=radio][data-value="${value}"]`,
  );
  if (!found) throw new Error(`no ${value} card in ${slot}`);
  return found;
}
