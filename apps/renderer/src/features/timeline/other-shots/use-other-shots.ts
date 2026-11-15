// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * When a clip's other shots show (EDT2), for the scenes strip and the detailed timeline alike: the pointer rests on
 * a clip for a moment, or ↑ on the focused clip. It keeps out of the way of the editing under it: nothing opens
 * while a button is held (a drag, a trim, a scrub, a range), a press lets go of it and the pressed clip stays quiet
 * until the pointer has left it, and it closes when the timeline scrolls, the window resizes, the clip goes or the
 * AI takes the timeline. Opened by the pointer, it closes soon after the pointer leaves both the clip and the
 * panel; opened by the keyboard, on Escape, ↓ or Tab, with focus back on the clip.
 */
import type { TimelineItemId } from '@taalcut/core';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { KEYS } from '../keys';

/** How long the pointer rests on a clip before its other shots show. */
export const REST_MS = 350;
/** Time to cross from the clip to the panel (and back) before it closes. */
export const LEAVE_MS = 200;
/** Movement within this many pixels still counts as resting. */
const STILL_PX = 4;
/** A clip wider than this opens the panel over the pointer, not over its middle. */
const WIDE_PX = 280;
/** A scene of the simple strip, or a clip of the detailed timeline. */
const CLIP = '[data-scene-clip], [data-slot="timeline-clip"]';
const SCENE = '[data-scene-clip]';

export interface ShownShots {
  readonly clipId: TimelineItemId;
  /** The clip's block: the panel opens beside it. */
  readonly anchor: HTMLElement;
  readonly by: 'pointer' | 'keys';
  /** Where the pointer rested (client px); null from the keyboard. */
  readonly x: number | null;
  /** In the simple scenes strip, where a clip is "Scene 3". */
  readonly scene: boolean;
}

const clipIdOf = (anchor: HTMLElement) =>
  (anchor.dataset.sceneClip ?? anchor.dataset.clipId ?? null) as TimelineItemId | null;

/** What takes focus for a clip: the scene's button in the strip, the clip itself on the timeline. */
export function focusTargetOf(anchor: HTMLElement): HTMLElement | null {
  return anchor.matches(SCENE) ? anchor.querySelector<HTMLElement>('button') : anchor;
}

/** Where the panel anchors: the clip, or the spot the pointer rested on when the clip is long. */
export function anchorRect(shown: ShownShots): DOMRect {
  const rect = shown.anchor.getBoundingClientRect();
  if (shown.x === null || rect.width <= WIDE_PX) return rect;
  return new DOMRect(Math.min(rect.right, Math.max(rect.left, shown.x)), rect.top, 0, rect.height);
}

export interface OtherShotsIntent {
  /** The clip the panel is for; kept while the panel leaves. */
  readonly shown: ShownShots | null;
  readonly open: boolean;
  close(): void;
  /** The panel's element, to tell its own focus and scrolling from the page's. */
  readonly panel: RefObject<HTMLDivElement | null>;
  /** Handlers for the element around the clips. */
  readonly zone: {
    onPointerMove(event: PointerEvent<HTMLElement>): void;
    onPointerLeave(): void;
    onPointerDown(event: PointerEvent<HTMLElement>): void;
    onKeyDown(event: KeyboardEvent<HTMLElement>): void;
    onKeyDownCapture(event: KeyboardEvent<HTMLElement>): void;
  };
  /** Handlers for the panel. */
  readonly over: {
    onPointerEnter(): void;
    onPointerLeave(): void;
    /** The Escape that closed the panel: it isn't also the clip's own Escape. */
    onEscapeKeyDown(event: Event): void;
  };
}

export function useOtherShots(canShow: (clipId: TimelineItemId) => boolean): OtherShotsIntent {
  const [state, setState] = useState<{ shown: ShownShots | null; open: boolean }>({
    shown: null,
    open: false,
  });
  const panel = useRef<HTMLDivElement | null>(null);
  const rest = useRef<{ clipId: string; x: number; y: number; timer: number } | null>(null);
  const leaving = useRef<number | null>(null);
  /** The clip a press landed on: quiet until the pointer has been somewhere else. */
  const pressed = useRef<string | null>(null);
  const escaped = useRef<Event | null>(null);
  const latest = useRef({ ...state, canShow });
  latest.current = { ...state, canShow };

  const disarm = () => {
    if (rest.current) window.clearTimeout(rest.current.timer);
    rest.current = null;
  };
  const stay = () => {
    if (leaving.current !== null) window.clearTimeout(leaving.current);
    leaving.current = null;
  };
  const close = () => {
    disarm();
    stay();
    const { shown, open } = latest.current;
    if (!open) return;
    // Focus inside a panel that is going would be lost: it goes back to the clip.
    if (shown && panel.current?.contains(document.activeElement)) focusTargetOf(shown.anchor)?.focus();
    setState((now) => ({ ...now, open: false }));
  };
  const leaveSoon = () => {
    const { shown, open } = latest.current;
    if (!open || shown?.by !== 'pointer' || leaving.current !== null) return;
    leaving.current = window.setTimeout(() => {
      leaving.current = null;
      close();
    }, LEAVE_MS);
  };
  const show = (shown: ShownShots) => {
    disarm();
    stay();
    if (!shown.anchor.isConnected || !latest.current.canShow(shown.clipId)) return;
    setState({ shown, open: true });
  };
  const gone = useEffectEvent(close);

  useEffect(
    () => () => {
      if (rest.current) window.clearTimeout(rest.current.timer);
      if (leaving.current !== null) window.clearTimeout(leaving.current);
    },
    [],
  );

  const { shown, open } = state;
  // The clip went (an edit, another view over it) or may not be swapped now: nothing to stand beside.
  useEffect(() => {
    if (!open || !shown) return;
    if (!shown.anchor.isConnected || shown.anchor.closest('[hidden]') || !canShow(shown.clipId)) gone();
  });
  // A press anywhere else (the start of a select, a drag, a trim, a scrub) or the timeline moving under it. The
  // press is heard on its way down, at once: the kit's popover waits for the click that ends a press, which a
  // drag only gives when it is over, and a handler that keeps a press to itself would hide it.
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      gone();
    };
    const onResize = () => gone();
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', outside, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const clipUnder = (target: EventTarget) => {
    const anchor = target instanceof Element ? target.closest<HTMLElement>(CLIP) : null;
    const clipId = anchor ? clipIdOf(anchor) : null;
    return anchor && clipId ? { anchor, clipId, scene: anchor.matches(SCENE) } : null;
  };

  return {
    shown,
    open,
    close,
    panel,
    zone: {
      onPointerMove(event) {
        if (event.pointerType === 'touch') return;
        // A held button is a drag, a trim, a scrub or a range: nothing opens under it.
        if (event.buttons !== 0) {
          disarm();
          return;
        }
        const under = clipUnder(event.target);
        if (under?.clipId !== pressed.current) pressed.current = null;
        if (!under || pressed.current || !latest.current.canShow(under.clipId)) {
          disarm();
          leaveSoon();
          return;
        }
        const now = latest.current;
        if (now.open && now.shown?.clipId === under.clipId && now.shown.anchor === under.anchor) {
          disarm();
          stay();
          return;
        }
        leaveSoon();
        const { clientX: x, clientY: y } = event;
        const armed = rest.current;
        if (armed?.clipId === under.clipId && Math.hypot(x - armed.x, y - armed.y) <= STILL_PX) return;
        disarm();
        const timer = window.setTimeout(() => {
          rest.current = null;
          show({ ...under, by: 'pointer', x });
        }, REST_MS);
        rest.current = { clipId: under.clipId, x, y, timer };
      },
      onPointerLeave() {
        pressed.current = null;
        disarm();
        leaveSoon();
      },
      onPointerDown(event) {
        pressed.current = clipUnder(event.target)?.clipId ?? null;
        disarm();
      },
      onKeyDown(event) {
        if (event.key !== KEYS.otherShots || event.defaultPrevented) return;
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const under = clipUnder(event.target);
        if (!under || focusTargetOf(under.anchor) !== event.target) return;
        if (!latest.current.canShow(under.clipId)) return;
        event.preventDefault();
        event.stopPropagation();
        show({ ...under, by: 'keys', x: null });
      },
      onKeyDownCapture(event) {
        if (escaped.current && event.nativeEvent === escaped.current) event.stopPropagation();
        escaped.current = null;
      },
    },
    over: {
      onPointerEnter() {
        disarm();
        stay();
      },
      onPointerLeave: leaveSoon,
      onEscapeKeyDown(event) {
        escaped.current = event;
      },
    },
  };
}
