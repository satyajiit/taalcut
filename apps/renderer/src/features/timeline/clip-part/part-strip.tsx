// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the part's strip (TRIM1) · system: DESIGN.md v0.7 (marigold is the live
 *   choice, as the playhead; footage on the viewer grey)
 * the whole file across the width as its own frames (the Library's filmstrip sprite: never decoded here), its
 *   shots parted by hairlines, and on it the window: the part the scene plays, clear while the rest of the file
 *   is dimmed. The window drags along the file; a grip on each side drags that end; a press on the strip beside
 *   the window starts the part where the pointer is. Each of the three is a slider (role, value in seconds, label)
 * states: default · hover (the grab cursor; a grip brightens; the frame under the pointer shows in the picture) ·
 *   focus (the base ring on the window or the grip) · dragging (a time over the end that moves) · disabled (the
 *   window greys and nothing drags: locked, the AI is editing, or a change is on its way) · loading (a bone the
 *   strip's size) · no frames (a plain track with the shots' marks; the window works the same) · error: the
 *   control's own line
 * motion: none; the window follows the hand. The frames fade in once the sprite has loaded (150 ms under reduced
 *   motion, base.css)
 */
import { cn } from '@taalcut/ui';
import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from 'react';
import { SpriteFrames, useSlots } from '../../library/clip/scrubber/clip-filmstrip';
import { useSpriteLoad } from '../../library/clip/scrubber/sprite';
import type { ShotStrip } from '../shot-frames';
import { fractionAt, msAt, type PartModel } from './part-model';
import type { PartGesture, PartGestures } from './use-part-gestures';

export interface SliderWords {
  readonly label: string;
  readonly value: string;
}

export interface PartStripProps {
  part: PartModel;
  gestures: PartGestures;
  /** The file's filmstrip, once there is one. */
  frames: ShotStrip | undefined;
  /** The clip's shape, width over height. */
  ratio: number;
  disabled: boolean;
  /** The file's detail is on its way: a bone. */
  loading: boolean;
  /** False for the video's first scene, whose beginning can't be trimmed. */
  startEdge: boolean;
  words: Readonly<Record<PartGesture, SliderWords>>;
  /** The time over the end that moves, while it moves. */
  moving: ReactNode;
  stripRef: RefObject<HTMLDivElement | null>;
  /** The media frame under the pointer while nothing is held; null when it leaves. */
  onHover(frame: number | null): void;
  onKey(gesture: PartGesture, event: KeyboardEvent<HTMLElement>): void;
}

const GRIP =
  'group/grip absolute inset-y-0 z-2 flex w-3 touch-none items-center justify-center border border-playhead-strong bg-playhead';
/** A grip that can't be dragged now: grey, as the window's frame. */
const OFF = 'cursor-not-allowed border-rule-strong bg-chip';

export function PartStrip({
  part,
  gestures,
  frames,
  ratio,
  disabled,
  loading,
  startEdge,
  words,
  moving,
  stripRef,
  onHover,
  onKey,
}: PartStripProps) {
  const slots = useSlots(ratio);
  const load = useSpriteLoad(frames?.src ?? null);
  const drawn = frames && load !== 'broken' ? frames : null;
  const left = fractionAt(part, gestures.from) * 100;
  const right = fractionAt(part, gestures.to) * 100;
  const length = msAt(part, part.fileTo);
  const held = gestures.by === 'pointer';

  const slider = (gesture: PartGesture, min: number, max: number, now: number) => ({
    role: 'slider' as const,
    tabIndex: 0,
    'aria-label': words[gesture].label,
    'aria-valuetext': words[gesture].value,
    'aria-valuemin': Math.round(msAt(part, min)) / 1000,
    'aria-valuemax': Math.round(msAt(part, max)) / 1000,
    'aria-valuenow': Math.round(msAt(part, now)) / 1000,
    'aria-orientation': 'horizontal' as const,
    'aria-disabled': disabled || undefined,
    'data-live': gestures.gesture === gesture ? (gestures.by ?? undefined) : undefined,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => onKey(gesture, event),
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      // The strip under it must not take this press for its own.
      event.stopPropagation();
      gestures.grab(gesture, event, 'window');
    },
  });
  const grip = (
    <span
      aria-hidden
      className="h-4 w-0.5 rounded-pill bg-playhead-ink opacity-70 group-hover/grip:opacity-100"
    />
  );

  return (
    <div
      ref={(element) => {
        slots.ref.current = element;
        stripRef.current = element;
      }}
      data-slot="part-strip"
      data-state={loading ? 'loading' : drawn ? 'frames' : 'plain'}
      data-held={held || undefined}
      className={cn(
        'relative h-14 touch-none select-none',
        disabled ? 'cursor-not-allowed' : held ? 'cursor-grabbing' : 'cursor-pointer',
      )}
      onPointerDown={(event) => gestures.grab('move', event, 'strip')}
      onPointerMove={(event) => {
        if (held) return gestures.drag(event);
        const box = event.currentTarget.getBoundingClientRect();
        if (box.width > 0)
          onHover(part.fileFrom + ((event.clientX - box.left) / box.width) * (part.fileTo - part.fileFrom));
      }}
      onPointerUp={gestures.drop}
      onPointerCancel={() => gestures.cancel()}
      onPointerLeave={() => onHover(null)}
    >
      <div
        className={cn(
          'absolute inset-0 overflow-hidden rounded-md',
          loading
            ? 'tc-bone bg-hover'
            : drawn
              ? 'bg-viewer'
              : 'border border-dashed border-rule-strong bg-sunken',
        )}
      >
        {drawn ? (
          <>
            {/* The file, dimmed; then the part itself, clear. */}
            <div
              data-ready={load === 'ready' || undefined}
              className="absolute inset-0 flex opacity-0 transition-opacity duration-(--dur-short) ease-(--ease-out) data-[ready]:opacity-40"
            >
              <SpriteFrames
                strip={drawn.filmstrip}
                src={drawn.src}
                count={slots.count}
                slot={slots.slot}
                length={length}
              />
            </div>
            <div
              data-ready={load === 'ready' || undefined}
              className="absolute inset-0 flex opacity-0 transition-opacity duration-(--dur-short) ease-(--ease-out) data-[ready]:opacity-100"
              style={{ clipPath: `inset(0 ${100 - right}% 0 ${left}%)` }}
            >
              <SpriteFrames
                strip={drawn.filmstrip}
                src={drawn.src}
                count={slots.count}
                slot={slots.slot}
                length={length}
              />
            </div>
          </>
        ) : loading ? null : (
          <span
            aria-hidden
            className="absolute inset-y-0 bg-selected"
            style={{ left: `${left}%`, width: `${right - left}%` }}
          />
        )}
        {part.shots.slice(1).map((shot) => (
          <span
            key={shot.id}
            aria-hidden
            data-slot="part-cut"
            className={cn('absolute inset-y-0 w-px', drawn ? 'bg-viewer-ink/85' : 'bg-rule-strong')}
            style={{ left: `${fractionAt(part, shot.from) * 100}%` }}
          />
        ))}
      </div>
      {loading ? null : (
        <>
          <div
            {...slider('move', part.fileFrom, part.fileTo - part.needs, gestures.from)}
            data-slot="part-window"
            className={cn(
              'absolute inset-y-0 z-1 touch-none border-y-2',
              disabled ? 'cursor-not-allowed border-rule-strong' : 'border-playhead',
              !disabled && (held ? 'cursor-grabbing' : 'cursor-grab'),
            )}
            style={{ left: `${left}%`, width: `${right - left}%` }}
          />
          {startEdge ? (
            <div
              {...slider('start', part.fileFrom, part.to, gestures.from)}
              data-slot="part-edge"
              data-edge="start"
              className={cn(GRIP, '-translate-x-full rounded-l-md', disabled ? OFF : 'cursor-ew-resize')}
              style={{ left: `${left}%` }}
            >
              {grip}
            </div>
          ) : (
            <span
              aria-hidden
              data-slot="part-edge-fixed"
              className={cn(GRIP, 'w-1 -translate-x-full rounded-l-md', disabled && OFF)}
              style={{ left: `${left}%` }}
            />
          )}
          <div
            {...slider('end', part.from, part.fileTo, gestures.to)}
            data-slot="part-edge"
            data-edge="end"
            className={cn(GRIP, 'rounded-r-md', disabled ? OFF : 'cursor-ew-resize')}
            style={{ left: `${right}%` }}
          >
            {grip}
          </div>
          {moving ? (
            <span
              aria-hidden
              data-slot="part-time"
              className="pointer-events-none absolute -top-7 z-3 -translate-x-1/2 rounded-md bg-tooltip px-1.5 py-0.5 type-caption whitespace-nowrap text-on-tooltip tabular-nums"
              style={{ left: `${gestures.gesture === 'end' ? right : left}%` }}
            >
              {moving}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}
