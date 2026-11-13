// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The solver's hard keep-outs and soft costs (FRM1-OVL). Hard: every head on any frame of the item's span, with a
 * margin, swept between samples so a moving head is kept clear between them too. Soft: covering a person's body
 * or silhouette, a busy (salient) background behind words on the picture, and a conversation that stops reading
 * like a chat (its order or its columns). Pure.
 */
import { area, centreX, centreY, inflate, overlap, right, union, type Rect } from './geometry';
import type { Placed, PlacementItem, SceneFrame, SolverConfig } from './types';

const near = (a: Rect, b: Rect) =>
  Math.hypot(centreX(a) - centreX(b), centreY(a) - centreY(b)) <= 1.5 * Math.max(a.width, a.height, 1);

/** The margin kept round a head: a share of its height, within the config's floor and ceiling. */
export const headMarginOf = (head: Rect, config: SolverConfig) =>
  Math.min(config.headMarginMaxPx, Math.max(config.headMarginPx, config.headMargin * head.height));

/**
 * Every head over the frames, each grown by the margin; a head and its nearest one in the next frame are kept
 * out together (the ground it covers between the two samples).
 */
export function headKeepOuts(frames: readonly SceneFrame[], config: SolverConfig): Rect[] {
  const grow = (head: Rect) => inflate(head, headMarginOf(head, config));
  const out: Rect[] = [];
  frames.forEach((frame, index) => {
    const next = frames[index + 1];
    for (const head of frame.heads) {
      out.push(grow(head));
      const after = next?.heads
        .filter((other) => near(head, other))
        .sort((a, b) => Math.abs(centreX(a) - centreX(head)) - Math.abs(centreX(b) - centreX(head)))[0];
      if (after) out.push(grow(union(head, after)));
    }
  });
  return out;
}

/** The mean share of the box over people (their silhouette where the track has one, else their boxes). */
function bodyShare(box: Rect, frames: readonly SceneFrame[]): number {
  if (frames.length === 0) return 0;
  const size = Math.max(1, area(box));
  let total = 0;
  for (const frame of frames) {
    const covered = frame.silhouette
      ? frame.silhouette(box)
      : Math.min(1, frame.people.reduce((sum, person) => sum + overlap(box, person), 0) / size);
    total += covered;
  }
  return total / frames.length;
}

function busyShare(box: Rect, frames: readonly SceneFrame[]): number {
  if (frames.length === 0) return 0;
  const size = Math.max(1, area(box));
  let total = 0;
  for (const frame of frames)
    total += Math.min(1, frame.salient.reduce((sum, region) => sum + overlap(box, region), 0) / size);
  return total / frames.length;
}

export function sceneCost(
  item: PlacementItem,
  box: Rect,
  frames: readonly SceneFrame[],
  config: SolverConfig,
): number {
  const busy = busyShare(box, frames) * (item.onPicture ? 1 : 0.3);
  return config.weights.body * bodyShare(box, frames) + config.weights.busy * busy;
}

/**
 * A bubble against the conversation's bubbles placed before it: the same vertical order as the reel's where both
 * are on screen, a left-tailed bubble in the left column and a right-tailed one in the right column, each column
 * lined up on its outer edge as a chat app does.
 */
export function conversationCost(
  item: PlacementItem,
  box: Rect,
  placed: readonly { readonly item: PlacementItem; readonly placed: Placed }[],
  config: SolverConfig,
  width: number,
): number {
  const chat = item.chat;
  if (!chat) return 0;
  let cost = 0;
  for (const { item: other, placed: done } of placed) {
    if (other.chat?.conversation !== chat.conversation) continue;
    const together = item.span.start < other.span.end && other.span.start < item.span.end;
    if (together) {
      const reelBelow = centreY(item.reel) >= centreY(other.reel);
      const madeBelow = centreY(box) >= centreY(done.box);
      if (reelBelow !== madeBelow) cost += config.weights.order;
    }
    if (chat.tail === 'none' || other.chat.tail === 'none') continue;
    if (other.chat.tail === chat.tail) {
      const offset =
        chat.tail === 'left' ? Math.abs(box.x - done.box.x) : Math.abs(right(box) - right(done.box));
      cost += config.weights.column * Math.min(1, offset / Math.max(1, width / 8));
    } else {
      // The other speaker's bubbles sit on the other side.
      const leftOfOther = centreX(box) < centreX(done.box);
      if (leftOfOther !== (chat.tail === 'left')) cost += config.weights.column;
    }
  }
  return cost;
}
