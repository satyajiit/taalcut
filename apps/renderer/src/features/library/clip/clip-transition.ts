// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The shared element between a Library tile and the clip's viewer (UX2, DESIGN.md v0.5): both frames carry the
 * clip's view-transition name, so opening a clip grows its tile into the viewer, and going back to the Library
 * shrinks the viewer into its tile. The far side arrives after the route has changed (the clip's data, the
 * Library's grid), so each transition's new picture waits for its frame (up to OPEN_WAIT_MS opening a clip,
 * CLOSE_WAIT_MS going back; past that the page shows as it is and the frame fades). While one runs the html element
 * says so (`data-clip-moving`, app.css): the page underneath swaps at once and only the frame moves.
 */
import { useBlocker } from '@tanstack/react-router';

/** The view-transition name both frames share. */
export function clipTransitionName(assetId: string): string {
  return `clip-${assetId}`;
}

/** The class app.css times the frame's move by. */
export const CLIP_FRAME_TRANSITION = '[view-transition-class:clip-frame]';

/**
 * The longest the old picture holds while the clip's viewer arrives (UX4, B18). The window draws nothing new while
 * it holds, so it is short: the tile has read the clip ahead (clip-prefetch.ts) and the page draws its picture
 * first, so the viewer is nearly always there sooner; when it isn't, the frame fades in rather than the window
 * standing still. It was 400 ms.
 */
const OPEN_WAIT_MS = 120;
/** The longest the old picture holds on the way back while the Library draws the clip's tile. */
const CLOSE_WAIT_MS = 400;

const canMove = () => typeof document.startViewTransition === 'function';

/** Runs `update` (which changes the page) in a view transition with only the frame moving; resolves when done. */
function moveFrame(update: () => Promise<void>): Promise<void> {
  const root = document.documentElement;
  root.dataset['clipMoving'] = '';
  return document
    .startViewTransition(update)
    .finished.catch(() => undefined)
    .finally(() => delete root.dataset['clipMoving']);
}

/**
 * Resolves once the clip's viewer frame is on the page (or OPEN_WAIT_MS has passed). It watches the DOM rather than
 * animation frames: the window draws none while a view transition waits for its new picture.
 */
function viewerArrived(assetId: string): Promise<void> {
  const name = clipTransitionName(assetId);
  const here = () =>
    document.querySelector<HTMLElement>('[data-slot=clip-frame]')?.style.viewTransitionName === name;
  if (here()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (here()) done();
    });
    const timer = setTimeout(done, OPEN_WAIT_MS);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

/**
 * Opens a clip from its tile with the frame growing into the viewer, where the window can (View Transitions);
 * elsewhere it just opens. `open` navigates.
 */
export function openClip(frame: HTMLElement | null, assetId: string, open: () => Promise<void>): void {
  if (!frame || !canMove()) {
    void open();
    return;
  }
  frame.style.viewTransitionName = clipTransitionName(assetId);
  void moveFrame(async () => {
    frame.style.viewTransitionName = '';
    await open();
    await viewerArrived(assetId);
  });
}

/**
 * The viewer's frame as a still, fixed where it is on the window, carrying the frame's name. The way back can't hold
 * the navigation until the old picture is taken (the window's history would lag a frame behind its address, and a
 * quick ⌘[ ⌘] would lose the ⌘]), so the router goes at once and the stand-in keeps the frame's picture for the
 * old capture, whenever the page goes.
 */
function standIn(frame: HTMLElement, assetId: string): HTMLElement {
  const box = frame.getBoundingClientRect();
  const look = getComputedStyle(frame);
  const stand = document.createElement('div');
  stand.setAttribute('aria-hidden', 'true');
  Object.assign(stand.style, {
    position: 'fixed',
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    borderRadius: look.borderRadius,
    background: look.backgroundColor,
    overflow: 'hidden',
    pointerEvents: 'none',
    viewTransitionName: clipTransitionName(assetId),
  });
  stand.style.setProperty('view-transition-class', 'clip-frame');
  const scale = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(box.width * scale);
  canvas.height = Math.round(box.height * scale);
  Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' });
  const context = canvas.getContext('2d');
  const video = frame.querySelector('video');
  const still = frame.querySelector('img');
  if (context && video && video.readyState >= 2) {
    // The frame has the video's shape: the picture fills it.
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
  } else if (context && still?.complete && still.naturalWidth > 0) {
    // The still fills the frame, cut to it (object-cover).
    const fit = Math.max(canvas.width / still.naturalWidth, canvas.height / still.naturalHeight);
    const width = still.naturalWidth * fit;
    const height = still.naturalHeight * fit;
    context.drawImage(still, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  }
  stand.append(canvas);
  document.body.append(stand);
  return stand;
}

/** The clip shrinking back into its tile while the Library's grid draws: the tile offers its frame as it mounts. */
let closing: { readonly assetId: string; readonly claim: (frame: HTMLElement) => void } | null = null;

/** A Library tile as it mounts: when its clip is the one closing, its frame takes the viewer's name for the move. */
export function claimClosingFrame(frame: HTMLElement | null, assetId: string): void {
  if (frame && closing?.assetId === assetId) closing.claim(frame);
}

/**
 * Goes back to the Library with the viewer shrinking into its tile; the navigation goes ahead at once. Only one
 * element carries the name at each capture: the stand-in for the old picture, the tile for the new one.
 */
function closeClip(assetId: string): void {
  const frame = document.querySelector<HTMLElement>('[data-slot=clip-frame]');
  if (!frame) return;
  const name = clipTransitionName(assetId);
  const stand = standIn(frame, assetId);
  frame.style.viewTransitionName = '';
  let tile: HTMLElement | null = null;
  let taken = false;
  let arrived: (() => void) | null = null;
  closing = {
    assetId,
    claim: (element) => {
      tile = element;
      if (!taken) return;
      element.style.viewTransitionName = name;
      arrived?.();
    },
  };
  void moveFrame(async () => {
    // The old picture is taken: the stand-in goes, the tile takes the name.
    stand.remove();
    taken = true;
    if (tile) {
      tile.style.viewTransitionName = name;
      return;
    }
    await new Promise<void>((done) => {
      arrived = done;
      setTimeout(done, CLOSE_WAIT_MS);
    });
  }).then(() => {
    // The name is the tile's only for the move: a later open names its own.
    closing = null;
    if (tile) tile.style.viewTransitionName = '';
  });
}

/**
 * A clip's page: on the way back to the Library (back, ⌘[, the breadcrumb), its viewer closes into its tile. Only
 * while the viewer is there (`shown`). It never blocks, and never holds the navigation.
 */
export function useCloseIntoTile(assetId: string, shown: boolean): void {
  useBlocker({
    disabled: !shown,
    shouldBlockFn: ({ current, next }) => {
      if (canMove() && next.pathname === '/library' && current.pathname === `/library/${assetId}`)
        closeClip(assetId);
      return false;
    },
    enableBeforeUnload: false,
  });
}
