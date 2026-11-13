// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { CSSProperties } from 'react';
import type { CameraRoll, Reel, RollClip } from '#content/schema';

/**
 * The sample camera roll on the stage (pure; test/unit/demo-roll.test.ts): which days the wall shows, which clip each
 * slot's pick comes from, the candidates the sift keeps, and a thumbnail's place in the sprite atlas.
 *
 * A pick names its clip (Pick.clipId). While the reels are placeholders their picks name no clip in the roll, so a
 * stand-in is chosen from the shown days by a stable hash: the same reel always picks the same cells, on the server
 * and in the browser.
 */

export interface RollDay {
  /** ISO date. */
  readonly day: string;
  readonly clips: readonly RollClip[];
}

export function groupByDay(clips: readonly RollClip[]): RollDay[] {
  const days = new Map<string, RollClip[]>();
  for (const clip of clips) {
    const list = days.get(clip.day);
    if (list) list.push(clip);
    else days.set(clip.day, [clip]);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => ({ day, clips: list }));
}

/**
 * The days the wall shows: every day that holds a real pick of any reel (so a flight always has a cell to leave
 * from, whichever reel is chosen), then the earliest others, up to `max`, in date order.
 */
export function shownDays(roll: CameraRoll, reels: readonly Reel[], max: number): RollDay[] {
  const all = groupByDay(roll.clips);
  const ids = new Set(roll.clips.map((c) => c.id));
  const needed = new Set(
    reels.flatMap((r) => r.slots.map((s) => s.pick.clipId)).filter((id) => ids.has(id)).map((id) => roll.clips.find((c) => c.id === id)?.day),
  );
  const keep = new Set(all.filter((d) => needed.has(d.day)).map((d) => d.day));
  for (const d of all) {
    if (keep.size >= Math.max(max, needed.size)) break;
    keep.add(d.day);
  }
  return all.filter((d) => keep.has(d.day));
}

/** A small stable hash (FNV-1a), so stand-in picks match between the server's HTML and the browser. */
export function stableHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface SlotPicks {
  /** The clip id each slot's pick comes from, in slot order. */
  readonly picks: readonly string[];
  /** The clips the sift keeps (each pick and its alternates). */
  readonly candidates: ReadonlySet<string>;
}

/** Where each of a reel's picks comes from on the shown wall, and the candidates around them. */
export function slotPicks(reel: Reel, days: readonly RollDay[]): SlotPicks {
  const pool = days.flatMap((d) => d.clips);
  const inPool = new Set(pool.map((c) => c.id));
  const taken = new Set<string>();
  const draw = (seed: string, fromDay: number): string | undefined => {
    if (pool.length === 0) return undefined;
    const day = days[fromDay % Math.max(days.length, 1)];
    const local = day && day.clips.length > 0 ? day.clips : pool;
    let i = stableHash(seed) % local.length;
    for (let tries = 0; tries < local.length; tries++, i = (i + 1) % local.length) {
      const id = local[i]?.id;
      if (id && !taken.has(id)) return id;
    }
    return pool.find((c) => !taken.has(c.id))?.id;
  };

  const picks = reel.slots.map((slot, i) => {
    const real = inPool.has(slot.pick.clipId) && !taken.has(slot.pick.clipId) ? slot.pick.clipId : undefined;
    // Spread stand-ins across the shown days, one day per slot, so the flights come from across the wall.
    const id = real ?? draw(`${reel.id}:${slot.id}`, Math.round((i * Math.max(days.length - 1, 0)) / Math.max(reel.slots.length - 1, 1)));
    if (id) taken.add(id);
    return id ?? '';
  });

  const candidates = new Set(picks.filter(Boolean));
  reel.slots.forEach((slot, i) => {
    for (let a = 0; a < slot.pick.alternates; a++) {
      const id = draw(`${reel.id}:${slot.id}:alt${a}`, i + a + 1);
      if (id) {
        taken.add(id);
        candidates.add(id);
      }
    }
  });
  return { picks, candidates };
}

/** A thumbnail cut from the atlas, sized to its box: background-size and position in percentages. */
export function spriteStyle(atlas: CameraRoll['atlas'], sprite: number): CSSProperties {
  const { columns, rows } = atlas;
  const index = Math.max(0, Math.min(sprite, columns * rows - 1));
  const col = index % columns;
  const row = Math.floor(index / columns);
  const x = columns > 1 ? (col / (columns - 1)) * 100 : 0;
  const y = rows > 1 ? (row / (rows - 1)) * 100 : 0;
  return {
    backgroundImage: `url(${atlas.src})`,
    backgroundSize: `${columns * 100}% ${rows * 100}%`,
    backgroundPosition: `${x}% ${y}%`,
    backgroundRepeat: 'no-repeat',
  };
}

/** A frame on the wall: one cell of the atlas, from one clip. */
export interface WallCell {
  readonly sprite: number;
  readonly clipId: string;
}

export interface WallDay {
  /** ISO date. */
  readonly day: string;
  readonly cells: readonly WallCell[];
}

/**
 * The wall's cells, under the shown days: every frame in the atlas whose clip is on one of those days, in atlas
 * order. The atlas holds more frames than the roll has clips, so the wall is dense with real footage, never repeats.
 */
export function wallDays(roll: CameraRoll, frames: readonly WallCell[], days: readonly RollDay[]): WallDay[] {
  const dayOf = new Map(roll.clips.map((c) => [c.id, c.day]));
  return days
    .map((d) => ({
      day: d.day,
      cells: frames.filter((f) => dayOf.get(f.clipId) === d.day).sort((a, b) => a.sprite - b.sprite),
    }))
    .filter((d) => d.cells.length > 0);
}

/** The wall cell a clip flies from: the frame that is the clip's own thumbnail, else its first frame. */
export function pickCellSprite(roll: CameraRoll, cells: readonly WallCell[], clipId: string): number | undefined {
  const own = roll.clips.find((c) => c.id === clipId)?.sprite;
  if (own !== undefined && cells.some((c) => c.sprite === own)) return own;
  return cells.find((c) => c.clipId === clipId)?.sprite;
}

/**
 * A crop from the middle of an atlas frame, `aspect` wide to 1 tall (1 is square, the way a camera roll shows it;
 * 3 / 4 is a grid post): with background-size `columns × 100% auto`, the position that centres frame `sprite` in a box
 * of that shape.
 */
export function spriteCropPosition(atlas: CameraRoll['atlas'], sprite: number, aspect = 1): string {
  const { columns, rows } = atlas;
  const index = Math.max(0, Math.min(sprite, columns * rows - 1));
  const col = index % columns;
  const row = Math.floor(index / columns);
  const tall = atlas.cell[1] / Math.max(atlas.cell[0], 1);
  const box = 1 / Math.max(aspect, 0.01);
  const x = columns > 1 ? (col / (columns - 1)) * 100 : 0;
  const travel = rows * tall - box;
  const y = travel > 0 ? ((row * tall + (tall - box) / 2) / travel) * 100 : 0;
  return `${Math.round(x * 100) / 100}% ${Math.round(y * 100) / 100}%`;
}

/** The square crop (spriteCropPosition at 1:1). */
export function squareSpritePosition(atlas: CameraRoll['atlas'], sprite: number): string {
  return spriteCropPosition(atlas, sprite, 1);
}

/** A frame of the roll cut to a box `aspect` wide to 1 tall, for a background. */
export function cropStyle(atlas: CameraRoll['atlas'], sprite: number, aspect = 1): CSSProperties {
  return {
    backgroundImage: `url(${atlas.src})`,
    backgroundSize: `${atlas.columns * 100}% auto`,
    backgroundPosition: spriteCropPosition(atlas, sprite, aspect),
    backgroundRepeat: 'no-repeat',
  };
}

const DAY_FORMAT = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const COUNT_FORMAT = new Intl.NumberFormat('en');

/** A day heading: "Oct 1". */
export function formatDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : DAY_FORMAT.format(date);
}

/** A count as words show it: "1,284". */
export function formatCount(n: number): string {
  return COUNT_FORMAT.format(n);
}
