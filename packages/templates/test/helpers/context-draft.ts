// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Drafts with on-screen text and speech for the slot-context tests (LRN1-CTX): the 4-second fixture with
 * overlays and segments of the test's choosing, and a long reel of equal slots with as much text as the
 * breakdown can keep, the worst case the limits are for.
 */
import { FrameRate, FrameRates, newId, RationalTime, type OverlayDesignKind } from '@taalcut/core';
import { breakdownDraftSchema, resolveCuts, type BreakdownDraft } from '../../src/index';
import {
  SLOT_CONTEXT_LIMITS,
  withSlotContext,
  type SlotContextLimits,
} from '../../src/breakdown/slot-context';
import { draftFixture } from './draft';

const fps30 = FrameRates.fps30;
const at = (value: number) => RationalTime.of(value, fps30);
const ms = (value: number) => RationalTime.of(value, FrameRate.of(1000));

export interface OverlaySpec {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly box?: { x: number; y: number; width: number; height: number };
  readonly role?: 'title' | 'label' | 'list' | 'caption' | 'cta' | 'other';
  readonly reveal?: 'none' | 'fade' | 'pop' | 'slide' | 'typewriter' | 'wordByWord';
  /** FIX-HOOK: a measured design of this kind and confidence. */
  readonly design?: { readonly kind: OverlayDesignKind; readonly confidence: number };
}

export interface SegmentSpec {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
}

export function overlay(spec: OverlaySpec): BreakdownDraft['text'][number] {
  return {
    id: newId(),
    text: spec.text,
    role: spec.role ?? 'caption',
    start: at(spec.start),
    duration: at(spec.end - spec.start),
    slotId: null,
    box: spec.box ?? { x: 0.1, y: 0.1, width: 0.8, height: 0.08 },
    appearance: { size: 0.05, align: 'center', case: 'mixed', background: 'none' },
    styleKey: 'caption',
    reveal: spec.reveal ?? 'none',
    language: 'en',
    confidence: 0.9,
    ...(spec.design
      ? {
          design: {
            kind: spec.design.kind,
            colors: { fill: '#f7f7f9', text: '#111111', stroke: null },
            cornerRadius: 0.3,
            tail: spec.design.kind === 'chatBubble' ? 'right' : 'none',
            font: { class: 'sans', weight: 400 },
            motion: { enter: 'none', exit: 'none', typing: false },
            confidence: spec.design.confidence,
          },
        }
      : {}),
  };
}

function speech(segments: readonly SegmentSpec[]): BreakdownDraft['audio']['speech'] {
  if (segments.length === 0) return null;
  return {
    language: 'en',
    coverage: 0.5,
    segments: segments.map((segment) => ({
      start: ms(segment.startMs),
      duration: ms(segment.endMs - segment.startMs),
      text: segment.text,
    })),
  };
}

/** The 4-second fixture (slots 0–30, 30–45, 45–90, 90–120 by the rule) with these overlays and segments. */
export function contextDraft(
  overlays: readonly OverlaySpec[],
  segments: readonly SegmentSpec[] = [],
  options: { readonly beats?: boolean } = {},
): BreakdownDraft {
  const base = draftFixture();
  return breakdownDraftSchema.parse({
    ...base,
    text: overlays.map(overlay),
    audio: { ...base.audio, speech: speech(segments) },
    beatMap: options.beats === false ? null : base.beatMap,
  });
}

/**
 * `slots` one-second slots at 30 fps, every cut found by both methods, each slot with `tracks` overlays of
 * `chars` characters and a segment of `words` words: more text than any slot may keep.
 */
export function longDraft(options: {
  readonly slots: number;
  readonly tracks: number;
  readonly chars: number;
  readonly words: number;
  readonly word?: string;
}): BreakdownDraft {
  const base = draftFixture();
  const frames = options.slots * 30;
  const word = options.word ?? 'word';
  const line = (slot: number, track: number) =>
    `${slot}.${track} ${'x'.repeat(Math.max(1, options.chars - 6))}`.slice(0, options.chars);
  return breakdownDraftSchema.parse({
    ...base,
    reference: { ...base.reference, source: { ...base.reference.source, duration: at(frames) } },
    duration: at(frames),
    cuts: Array.from({ length: options.slots - 1 }, (_, index) => ({
      frame: (index + 1) * 30,
      method: 'both',
      score: 40,
      distance: 0.7,
      transition: null,
    })),
    disputes: [],
    text: Array.from({ length: options.slots }, (_, slot) =>
      Array.from({ length: options.tracks }, (_, track) =>
        overlay({
          text: line(slot, track),
          start: slot * 30,
          end: slot * 30 + 30,
          box: { x: 0.1, y: 0.05 + track * 0.2, width: 0.8, height: 0.08 },
        }),
      ),
    ).flat(),
    audio: {
      ...base.audio,
      speech: speech(
        Array.from({ length: options.slots }, (_, slot) => ({
          text: Array.from({ length: options.words }, () => word).join(' '),
          startMs: slot * 1000,
          endMs: slot * 1000 + 1000,
        })),
      ),
    },
    slotFrames: Array.from({ length: options.slots }, (_, slot) => ({
      start: slot * 30,
      end: slot * 30 + 30,
      frames: [`frames/frame-${String(slot * 30 + 15).padStart(6, '0')}.jpg`],
    })),
    contactSheet: null,
  });
}

/** Each slot's context in slot order, every proposed cut kept (what `templates.resolveCuts` returns beside the frames). */
export function contextsOf(draft: BreakdownDraft, limits: SlotContextLimits = SLOT_CONTEXT_LIMITS) {
  return withSlotContext(draft, resolveCuts(draft, []).slots, limits).map(({ context }) => context);
}
