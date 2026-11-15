// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: the owner's lyric, made up. A portrait reel shows seven words one after another at one place (centred, a
 * little above the middle, each its own overlay, back to back), over four shots. The made video's four clips have
 * people's heads in different places, or nobody. No footage: every person is a box.
 */
import type { ShotProfile, Template, TextItem, Timeline } from '@taalcut/core';
import { createMemoryShotCatalog } from '../../src/casting/catalog';
import { createCastingEngine } from '../../src/casting/engine';
import { agentWorldOver, type AgentWorldOptions } from '../fixtures/agent';
import type { World } from '../fixtures/casting';
import { fakeEmbedder, makeProfile, near, unitVector } from '../fixtures/library';
import { buildTemplate } from '../fixtures/template';
import { fakeSubjects, type FakeBox } from './fake-subjects';
import { itemsOf } from './reel-world';

export const CANVAS = { width: 1080, height: 1920 };
/** The words' widths in the reel, as shares of the frame: each is centred on the frame's middle. */
export const WORD_WIDTHS = [0.2667, 0.1546, 0.25, 0.2639, 0.25, 0.2361, 0.2] as const;
export const WORDS = ['I hope', 'You', 'Leave', 'And', "Don't", 'Come', 'Back'] as const;
/** Each word's turn, in frames, and the reel's line: its middle at 48 % of the height. */
export const TURN = 12;
export const LINE = { middle: 0.48, height: 0.0406, size: 0.0284 } as const;

export interface LyricOptions {
  /** Where the words sit across the frame: their centres (default), or their left edges, on this share. */
  readonly anchor?: { readonly edge: 'center' | 'left'; readonly at: number };
  /** The line's middle, as a share of the height (default the reel's 0.48). */
  readonly middle?: number;
  /** The words' size (default the reel's 0.0284). */
  readonly size?: number;
}

/** One made-up text of a portrait reel: its words, its turn in frames, its box and size in the reel. */
export interface ReelText {
  readonly text: string;
  readonly start: number;
  readonly frames: number;
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly size: number;
  readonly align?: 'left' | 'center' | 'right';
}

/** A portrait reel of four shots with `texts` over it, and a library of portrait clips to cast it from. */
export function textWorld(texts: readonly ReelText[]): World {
  const intents = Array.from({ length: 4 }, (_, index) => unitVector(9_301 + index));
  const built = buildTemplate({
    slots: intents.map((_, index) => ({ frames: 21, text: `shot ${index}` })),
    overlays: texts.map((entry) => ({
      start: entry.start,
      frames: entry.frames,
      text: entry.text,
      slot: Math.min(3, Math.floor(entry.start / 21)),
      box: entry.box,
    })),
  });
  const template: Template = {
    ...built,
    text: built.text.map((overlay, index) => ({
      ...overlay,
      role: 'label',
      styleKey: 'label',
      appearance: {
        size: texts[index]!.size,
        align: texts[index]!.align ?? 'center',
        case: 'mixed',
        background: 'none',
      },
    })),
  };
  const profiles: ShotProfile[] = Array.from({ length: 12 }, (_, index) =>
    makeProfile({ embedding: near(intents[index % 4]!, 700 + index, 0.1), orientation: 'portrait' }),
  );
  const table = new Map(intents.map((vector, index) => [`shot ${index}`, vector]));
  const engine = createCastingEngine({
    catalog: createMemoryShotCatalog(profiles),
    embedder: fakeEmbedder(table),
  });
  return { template, profiles, acceptable: [], engine };
}

export function lyricWorld(options: LyricOptions = {}): World {
  const anchor = options.anchor ?? { edge: 'center', at: 0.5 };
  const middle = options.middle ?? LINE.middle;
  return textWorld(
    WORDS.map((text, index) => ({
      text,
      start: index * TURN,
      frames: TURN,
      box: {
        x: anchor.edge === 'center' ? anchor.at - WORD_WIDTHS[index]! / 2 : anchor.at,
        y: middle - LINE.height / 2,
        width: WORD_WIDTHS[index]!,
        height: LINE.height,
      },
      size: options.size ?? LINE.size,
      align: anchor.edge === 'center' ? 'center' : 'left',
    })),
  );
}

/** Heads by the made video's clip, in order (clip 0, 1, 2, 3): filled in once the timeline is assembled. */
export type HeadsByClip = readonly (readonly FakeBox[])[];

export const lyricVideo = (heads: HeadsByClip, options: LyricOptions = {}) =>
  madeVideo(lyricWorld(options), heads);

/** The world's reel made into a video, its clips' heads as given. */
export async function madeVideo(world: World, heads: HeadsByClip = [], options: AgentWorldOptions = {}) {
  const byAsset = new Map<string, readonly FakeBox[]>();
  const subjects = fakeSubjects((asset) => byAsset.get(asset) ?? []);
  const w = agentWorldOver(world, { ...options, subjects });
  const made = await w.call('timeline.assemble', { projectId: w.projectId, template: { id: w.template.id } });
  if (!made.ok) throw new Error(made.error.code);
  const timeline: Timeline = w.store.docs.get((made.value.timelineIds as string[])[0]!)!;
  const clips = timeline.tracks.flatMap((track) =>
    track.kind === 'video' ? track.items.filter((item) => item.type === 'clip') : [],
  );
  clips.forEach((clip, index) => {
    if (clip.type === 'clip') byAsset.set(clip.media.assetId, heads[index] ?? []);
  });
  return { w, timeline, subjects };
}

/** The lyric's words in the made video, in the order they show. */
export const wordsOf = (timeline: Timeline): TextItem[] =>
  itemsOf(timeline)
    .filter((item): item is TextItem => item.type === 'text')
    .sort((a, b) => a.start.value - b.start.value);

export const centreOf = (item: TextItem) => ({
  x: item.box.x + item.box.width / 2,
  y: item.box.y + item.box.height / 2,
});
export const spreadOf = (values: readonly number[]) => Math.max(...values) - Math.min(...values);
