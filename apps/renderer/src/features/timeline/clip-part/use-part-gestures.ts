// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TRIM1: the hand on the part. A drag (the window or one of its ends), a press on the strip beside the window (the
 * part starts where the pointer is), and steps from the keys or the buttons all make a draft the strip draws at once;
 * nothing is sent until the pointer lets go, or the steps have stopped for a moment (`SETTLE_MS`: a held arrow or a
 * run of presses is one command and one undo step). Escape puts a drag or unsent steps back. A refused command
 * puts the window back and keeps its cause for the control to say; the editor's own line under the transport is
 * cleared, so it is said once, where the hand is.
 */
import type { Result, TaalcutError, TimelineItemId } from '@taalcut/core';
import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { Edits } from '../use-edits';
import { halfSecond, type PartModel, type PartShot } from './part-model';
import {
  edgeAt,
  edgeStep,
  edgeTo,
  moveCommand,
  moveStep,
  moveTo,
  moveToEnd,
  type CutGrid,
  type EdgeStop,
  type EdgeTarget,
  type MoveTarget,
} from './part-moves';

export type PartGesture = 'move' | 'start' | 'end';

/** How long after the last step the change is sent, ms. */
export const SETTLE_MS = 450;
/** How long a sent change keeps its place while the timeline's new revision is on its way, ms. */
export const HOLD_MS = 900;

type Draft =
  | { readonly gesture: 'move'; readonly target: MoveTarget }
  | { readonly gesture: 'start' | 'end'; readonly target: EdgeTarget };

interface Live {
  readonly draft: Draft;
  readonly by: 'pointer' | 'keys' | 'sent';
}

export interface PartRefusal {
  readonly gesture: PartGesture;
  readonly error: TaalcutError;
}

export interface PartGestures {
  /** The part as drawn: the draft while a gesture is live, else what the scene plays (media frames). */
  readonly from: number;
  readonly to: number;
  /** The gesture under way and how: dragged, stepped and not sent yet, or sent and landing. */
  readonly gesture: PartGesture | null;
  readonly by: Live['by'] | null;
  /** Canvas frames an end's draft adds to the scene (negative: takes off). */
  readonly trim: number;
  /** Why an end's draft stays short of where it was asked to go. */
  readonly stop: EdgeStop | null;
  /** The shot a move's draft sits in. */
  readonly shot: PartShot | null;
  readonly refusal: PartRefusal | null;
  /** Counts each change that went through, for the announcement. */
  readonly landed: number;
  grab(gesture: PartGesture, event: PointerEvent<HTMLElement>, on: 'window' | 'strip'): void;
  drag(event: PointerEvent<HTMLElement>): void;
  drop(event: PointerEvent<HTMLElement>): void;
  /** Puts a drag or unsent steps back. True when there was something to put back. */
  cancel(): boolean;
  /** One step: `direction` 1 is later in the clip. */
  step(gesture: PartGesture, direction: -1 | 1, large: boolean): void;
  /** A move to the first or last place in the shot the part is in. */
  jump(end: 'first' | 'last'): void;
  /** Sends unsent steps now (Return, leaving the control). */
  settle(): void;
}

export interface PartGesturesInput {
  part: PartModel;
  clipId: TimelineItemId;
  edits: Edits;
  grid: CutGrid | null;
  disabled: boolean;
  /** The strip the window sits on: the file across its width. */
  strip: RefObject<HTMLElement | null>;
}

const unchanged = (draft: Draft) =>
  draft.gesture === 'move' ? draft.target.command === null : draft.target.by === 0;

const trimOf = (live: Live | null) => (live && live.draft.gesture !== 'move' ? live.draft.target.by : 0);

export function usePartGestures(input: PartGesturesInput): PartGestures {
  const { part, clipId, edits, grid, disabled, strip } = input;
  const [live, setLive] = useState<Live | null>(null);
  const [refusal, setRefusal] = useState<PartRefusal | null>(null);
  const [landed, setLanded] = useState(0);
  const pointer = useRef<{ id: number; gesture: PartGesture; offset: number } | null>(null);
  const timer = useRef<number | null>(null);
  // The draft as the handlers and timers see it, ahead of React's next render.
  const current = useRef<Live | null>(null);
  const alive = useRef(true);
  // Steps pressed while a change is on its way: taken once it has landed, from where the scene then plays.
  const queued = useRef<[PartGesture, -1 | 1, boolean][]>([]);
  // What timers, listeners and the unmount call: the latest render's own, whatever render set them up.
  const fresh = useRef<{
    settle(): void;
    cancel(): boolean;
    step(gesture: PartGesture, direction: -1 | 1, large: boolean): void;
  }>({ settle: () => undefined, cancel: () => false, step: () => undefined });

  const show = (next: Live | null) => {
    current.current = next;
    setLive(next);
  };
  const stopTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const frameAt = (clientX: number) => {
    const box = strip.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return part.from;
    return part.fileFrom + ((clientX - box.left) / box.width) * (part.fileTo - part.fileFrom);
  };

  const send = async (draft: Draft) => {
    stopTimer();
    const command = draft.gesture === 'move' ? moveCommand(part, clipId, draft.target) : null;
    if (unchanged(draft) || (draft.gesture === 'move' && !command)) return show(null);
    show({ draft, by: 'sent' });
    setRefusal(null);
    const result: Result<unknown> = command
      ? await edits.command(command.name, command.payload)
      : await edits.trim(clipId, draft.gesture as 'start' | 'end', trimOf({ draft, by: 'sent' }));
    if (!alive.current) return;
    if (!result.ok) {
      // Said beside the control, in the control's own words: not a second time under the transport.
      edits.clearError();
      setRefusal({ gesture: draft.gesture, error: result.error });
      queued.current = [];
      return show(null);
    }
    setLanded((count) => count + 1);
    // The timeline's next revision replaces the draft (the effect below); this is for a change that turned out to
    // be none (a cut that went back to its beat), so the window never stays where nothing is.
    timer.current = window.setTimeout(() => show(null), HOLD_MS);
  };

  const cancel = () => {
    const pending = current.current;
    queued.current = [];
    if (!pending || pending.by === 'sent') return false;
    pointer.current = null;
    stopTimer();
    show(null);
    return true;
  };

  /** Unsent steps go now. */
  const settle = () => {
    const pending = current.current;
    if (pending?.by === 'keys') void send(pending.draft);
  };

  const later = () => {
    stopTimer();
    timer.current = window.setTimeout(() => fresh.current.settle(), SETTLE_MS);
  };

  // The scene changed under the draft (the command landed, an undo, the AI): what it plays now is the truth.
  const signature = `${part.assetId}:${part.shotId}:${part.from}:${part.cutIn}:${part.cutOut}`;
  useEffect(() => {
    if (current.current?.by !== 'sent') return;
    stopTimer();
    show(null);
  }, [signature]);

  // Edits stopped being allowed mid-gesture (the AI took the timeline): let go without sending.
  useEffect(() => {
    if (disabled) fresh.current.cancel();
  }, [disabled]);

  useEffect(() => {
    alive.current = true;
    return () => {
      // Steps made and not sent yet still count: leaving the tool is not a cancel.
      fresh.current.settle();
      alive.current = false;
      stopTimer();
    };
  }, []);

  // Escape while a drag is held puts it back, and is not also the editor's "let go of the selection".
  const dragging = live?.by === 'pointer';
  useEffect(() => {
    if (!dragging) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !fresh.current.cancel()) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [dragging]);

  /** The part as a draft has it, else as the scene plays it. */
  const placed = (now: Live | null) => {
    const target = now?.draft.target;
    const from = target ? target.from : part.from;
    return { from, to: target && 'to' in target ? target.to : from + (part.to - part.from) };
  };
  const { from, to } = placed(live);
  /** Whether the hand may start something, and whether unsent steps of another kind went first instead. */
  const free = (gesture: PartGesture) => {
    const pending = current.current;
    if (disabled || pending?.by === 'sent' || pending?.by === 'pointer') return false;
    if (pending && pending.draft.gesture !== gesture) {
      settle();
      return false;
    }
    return true;
  };

  const step = (gesture: PartGesture, direction: -1 | 1, large: boolean) => {
    // A press while the last change is on its way waits for it: nothing is dropped.
    if (current.current?.by === 'sent') return void queued.current.push([gesture, direction, large]);
    if (!free(gesture)) return;
    setRefusal(null);
    show({
      draft:
        gesture === 'move'
          ? {
              gesture,
              target: moveStep(
                part,
                placed(current.current).from,
                direction * (large ? halfSecond(part.rate) : 1),
              ),
            }
          : { gesture, target: edgeStep(part, gesture, trimOf(current.current), direction, large, grid) },
      by: 'keys',
    });
    later();
  };
  fresh.current = { settle, cancel, step };
  // The change landed and edits are allowed again: the steps that waited go now.
  const idle = live === null && !disabled;
  useEffect(() => {
    if (!idle || queued.current.length === 0) return;
    const steps = queued.current;
    queued.current = [];
    for (const [gesture, direction, large] of steps) fresh.current.step(gesture, direction, large);
  }, [idle]);

  return {
    from,
    to,
    gesture: live?.draft.gesture ?? null,
    by: live?.by ?? null,
    trim: trimOf(live),
    stop: live && live.draft.gesture !== 'move' ? live.draft.target.stop : null,
    shot: live?.draft.gesture === 'move' ? live.draft.target.shot : null,
    refusal,
    landed,
    grab(gesture, event, on) {
      if (event.button !== 0 || !free(gesture)) return;
      event.preventDefault();
      stopTimer();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const at = frameAt(event.clientX);
      const now = placed(current.current);
      // On the strip beside the window, the part starts under the pointer: the frame the picture showed there.
      const offset = gesture === 'end' ? at - now.to : on === 'strip' ? 0 : at - now.from;
      pointer.current = { id: event.pointerId, gesture, offset };
      setRefusal(null);
      show({
        draft:
          gesture === 'move'
            ? { gesture, target: moveTo(part, on === 'strip' ? at - offset : now.from) }
            : { gesture, target: edgeAt(part, gesture, trimOf(current.current)) },
        by: 'pointer',
      });
    },
    drag(event) {
      const held = pointer.current;
      if (!held || held.id !== event.pointerId) return;
      const raw = frameAt(event.clientX) - held.offset;
      show({
        draft:
          held.gesture === 'move'
            ? { gesture: 'move', target: moveTo(part, raw) }
            : { gesture: held.gesture, target: edgeTo(part, held.gesture, raw, grid) },
        by: 'pointer',
      });
    },
    drop(event) {
      const held = pointer.current;
      if (!held || held.id !== event.pointerId) return;
      pointer.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      const pending = current.current;
      if (pending) void send(pending.draft);
    },
    cancel,
    step,
    jump(end) {
      if (!free('move')) return;
      setRefusal(null);
      show({
        draft: { gesture: 'move', target: moveToEnd(part, placed(current.current).from, end) },
        by: 'keys',
      });
      later();
    },
    settle,
  };
}
