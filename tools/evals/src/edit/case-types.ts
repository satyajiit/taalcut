// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EDT1-OPS: one edit eval case: the person's words, what they pointed at, and how to tell it was done. */
import type { GraphicsDesignJob, Timeline } from '@taalcut/core';
import type { Scope, Verdict } from './check';

export const EDIT_FAMILIES = [
  'structure',
  'trim',
  /** FIX-TRIM: another part of a clip's shot. */
  'slip',
  'speed',
  'transition',
  'colour',
  'sound',
  'text',
  'captions',
  'graphics',
  'multi',
  /** FIX-CMT: comments sent together ("Send N comments to Taalcut"), not a docked message. */
  'comments',
] as const;
export type EditFamily = (typeof EDIT_FAMILIES)[number];

/** What the person had selected: an original clip by index, a text, a cue by index, the graphic, the voice line or a stretch in seconds. */
export type Pick =
  | { readonly clip: number }
  | { readonly text: 'title' | 'caption' }
  | { readonly cue: number }
  | { readonly graphic: true }
  | { readonly voice: true }
  | { readonly range: readonly [number, number] };

/** FIX-CMT: one comment the person left: on what they picked or the whole video, at a moment (seconds) or none. */
export interface CaseComment {
  readonly on: Pick | 'video';
  readonly at?: number;
  readonly body: string;
}

export interface EditCase {
  readonly id: string;
  readonly family: EditFamily;
  readonly request: string;
  /** "This", "here", "it": the request points at the selection or the playhead. */
  readonly pointed?: boolean;
  readonly select?: readonly Pick[];
  /** Seconds; 0 when absent. */
  readonly playhead?: number;
  /**
   * FIX-CMT: the case is a batch of these comments, sent together with `request` as the message (the chat's words for
   * "Send N comments to Taalcut"), not a docked message; each must be answered, resolved.
   */
  readonly comments?: readonly CaseComment[];
  /** Commands run from the editor before the request, so the video has something to undo or change. */
  readonly setup?: readonly { readonly name: string; readonly payload: Record<string, unknown> }[];
  /** What the request may change. */
  readonly scope: Scope;
  /**
   * `asked`: the jobs the Editor gave the Designer (graphics.design, HFW1): a new graphic, or a new look for one,
   * is the Designer's, so a request for one is done when the Editor asks for it with the person's words and where.
   */
  check(before: Timeline, after: Timeline, asked: readonly GraphicsDesignJob[]): Verdict;
}

export const defineCases = (cases: readonly EditCase[]) => cases;
