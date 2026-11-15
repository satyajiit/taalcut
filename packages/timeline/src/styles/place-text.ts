// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: `timeline.placeText` as pure steps. Whoever makes the video states where each group of its text sits and
 * how large it is, and that is what is applied: nothing here moves a text into a safe area, raises it to a readable
 * size, keeps it off a head or refuses a place. A group is the texts the reel showed in turn at one place (a run,
 * runs.ts), or any other text on its own; a run moves as one, at one size, its texts set in its box the way `align`
 * says, so what is placed stays one system. Nothing reads what the words say.
 *
 * The box follows the words (text-box.ts): a placed text draws on one line for each line it is written on, at any
 * size, and its box is its words' own round the anchor. `width` is the only statement that wraps it.
 *
 * A stated place is an anchor: `x` is the group's left edge, centre or right edge as `align` names, `y` its middle,
 * both shares of the frame; `size` the capitals' height over the frame's. A part left out stays as it is. `asReel`
 * states the reel's own place and size. Every text placed records who placed it; a text a person placed is never
 * moved by anyone else.
 *
 * The one thing a place cannot do is leave the frame: a stored box lies inside it (core `boxSchema`, as every box
 * of a timeline always has). A group stated past the frame's edge sits at the edge, the least it has to move to be
 * stored, and the tools say so (`atFrameEdge`).
 */
import {
  err,
  ok,
  type CommandSource,
  type NormalisedBox,
  type Result,
  type Template,
  type TextItem,
  type TextPlace,
  type Timeline,
} from '@taalcut/core';
import { reelTextLayout } from '../assembly/placement/place-timeline';
import { runsOf } from '../assembly/placement/runs';
import { fitWords } from '../assembly/placement/text-size';
import { placedIn } from '../edits/text';
import type { EditResult } from '../edits/types';
import { InvalidMove } from '../errors';
import { fitShares, intoFrame, stored } from './text-box';

type Align = TextItem['appearance']['align'];
type Runs = Pick<Template, 'text' | 'canvas'>;

export interface TextGroup {
  /** The group's handle: the id of its first text. Any of its texts names it. */
  readonly id: string;
  readonly items: readonly TextItem[];
  /** Texts the reel showed in turn at one place. */
  readonly run: boolean;
}

/** Where a group sits now: its anchor, its alignment, its size and the box round all its texts. */
export interface GroupPlace {
  readonly x: number;
  readonly y: number;
  readonly align: Align;
  readonly size: number;
  readonly box: NormalisedBox;
}

const textsOf = (timeline: Pick<Timeline, 'tracks'>): TextItem[] =>
  timeline.tracks
    .flatMap((track) => (track.kind === 'text' && track.enabled ? track.items : []))
    .filter((item): item is TextItem => item.type === 'text')
    .sort((a, b) => a.start.value - b.start.value);

/** The video's text groups, in the order they first show: each run with two or more texts here, then the rest. */
export function textGroups(timeline: Pick<Timeline, 'tracks'>, template: Runs | null): TextGroup[] {
  const texts = textsOf(timeline);
  const grouped = new Set<string>();
  const groups: TextGroup[] = [];
  for (const run of template ? runsOf(template) : []) {
    const items = texts.filter((item) => item.overlayId !== null && run.includes(item.overlayId));
    if (items.length < 2) continue;
    for (const item of items) grouped.add(item.id);
    groups.push({ id: items[0]!.id, items, run: true });
  }
  for (const item of texts)
    if (!grouped.has(item.id)) groups.push({ id: item.id, items: [item], run: false });
  return groups.sort((a, b) => a.items[0]!.start.value - b.items[0]!.start.value);
}

const middle = (values: readonly number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)] ?? 0;

export function groupPlace(items: readonly TextItem[]): GroupPlace {
  const left = Math.min(...items.map((item) => item.box.x));
  const top = Math.min(...items.map((item) => item.box.y));
  const right = Math.max(...items.map((item) => item.box.x + item.box.width));
  const bottom = Math.max(...items.map((item) => item.box.y + item.box.height));
  const align = items[0]!.appearance.align;
  return {
    x: align === 'left' ? left : align === 'right' ? right : (left + right) / 2,
    y: (top + bottom) / 2,
    align,
    size: middle(items.map((item) => item.appearance.size)),
    box: { x: left, y: top, width: right - left, height: bottom - top },
  };
}

/**
 * The group's texts where `stated` puts them: exactly, with no limit but the frame's own edge. A run takes one
 * size, the one stated or the middle of its texts' sizes. Each text's box is its words' own at that size: one line
 * for each written line, or wrapped at `width` when that is stated. No size and no box wraps a sentence.
 */
function placed(
  items: readonly TextItem[],
  stated: TextPlace,
  source: CommandSource,
  canvas: Timeline['canvas'],
): TextItem[] {
  // Nothing but "as it is" (or "as the reel has it"): the place it has is the place stated.
  if ([stated.x, stated.y, stated.align, stated.size, stated.width].every((part) => part === undefined))
    return items.map((item) => placedIn(item, item.box, source));
  const now = groupPlace(items);
  const align = stated.align ?? now.align;
  const size = stated.size ?? now.size;
  const wrapAt = stated.width === undefined ? undefined : stated.width * canvas.width;
  const sizes = items.map((item) => fitShares(fitWords(item.text, size, canvas, wrapAt), canvas));
  const width = Math.max(...sizes.map((entry) => entry.width));
  const height = Math.max(...sizes.map((entry) => entry.height));
  // An anchor not stated stays where the group's box has it, for the alignment it now takes.
  const edge =
    align === 'left'
      ? now.box.x
      : align === 'right'
        ? now.box.x + now.box.width
        : now.box.x + now.box.width / 2;
  const x = stated.x ?? edge;
  const y = stated.y ?? now.y;
  const asStated = {
    left: align === 'left' ? x : align === 'right' ? x - width : x - width / 2,
    top: y - height / 2,
  };
  // Past the frame's edge: the group as one moves the least that brings it inside (a stored box cannot leave).
  const left = asStated.left + intoFrame(asStated.left, width);
  const top = asStated.top + intoFrame(asStated.top, height);
  return items.map((item, index) => {
    const own = sizes[index]!;
    const box = {
      x:
        align === 'left'
          ? left
          : align === 'right'
            ? left + width - own.width
            : left + (width - own.width) / 2,
      y: top + (height - own.height) / 2,
      ...own,
    };
    const breaks = wrapAt === undefined ? 'written' : 'width';
    return placedIn(
      { ...item, appearance: { ...item.appearance, align, size }, breaks },
      stored(box),
      source,
    );
  });
}

export interface PlacedText extends EditResult {
  /** The ids of the texts that now carry a stated place. */
  readonly placed: readonly string[];
}

/**
 * Every stated group placed, in the order stated. A text a person placed stays where it is unless the person is
 * the one placing. Refuses only an id that is no text of this video.
 */
export function placeText(
  timeline: Timeline,
  template: Template | null,
  places: readonly TextPlace[],
  options: { readonly source: CommandSource },
): Result<PlacedText> {
  let current = timeline;
  const done = new Set<string>();
  for (const stated of places) {
    const group = textGroups(current, template).find((entry) =>
      entry.items.some((item) => item.id === stated.itemId),
    );
    if (!group)
      return err(InvalidMove(undefined, { detail: `No text of this video has the id ${stated.itemId}.` }));
    const mine = (item: TextItem) => options.source !== 'agent' || item.placedBy !== 'person';
    const ids = new Set(group.items.filter(mine).map((item) => item.id));
    if (ids.size === 0) continue;
    // "As the reel has it": the reel's own place and size for the group, where the reel made it.
    if (stated.asReel && template)
      current = reelTextLayout({ timeline: current, template, only: ids, asked: ids });
    const items = textsOf(current).filter((item) => ids.has(item.id));
    const next = new Map(
      placed(items, stated, options.source, current.canvas).map((item) => [item.id, item]),
    );
    current = {
      ...current,
      tracks: current.tracks.map((track) =>
        track.kind === 'text'
          ? { ...track, items: track.items.map((item) => next.get(item.id) ?? item) }
          : track,
      ),
    };
    for (const id of ids) done.add(id);
  }
  return ok({ timeline: current, changed: done.size > 0 ? ['tracks'] : [], placed: [...done] });
}
