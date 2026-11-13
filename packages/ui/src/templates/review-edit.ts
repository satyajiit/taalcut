// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type {
  CameraMotion,
  CutSnap,
  DoubtReason,
  DoubtTarget,
  GraphicBriefPatch,
  Id,
  SoundCredit,
  Template,
  TemplateProposal,
} from '@taalcut/core';
import type { CutTime } from './cut-math';
import type { SlotEdit } from './use-slot-edits';

type SlotId = Id<'TemplateSlot'>;
type Role = Template['slots'][number]['role'];

/** Every fix the review makes (BRK1-REV): one bus command each, made on the version on screen, each undoable. */
export type ReviewEdit =
  | SlotEdit
  | { readonly kind: 'moveCut'; readonly slotId: SlotId; readonly to: CutTime; readonly snap: CutSnap }
  | { readonly kind: 'split'; readonly slotId: SlotId; readonly at: CutTime }
  /** "Not a cut": the slot joins the one before it. */
  | { readonly kind: 'notCut'; readonly slotId: SlotId }
  | { readonly kind: 'setRole'; readonly slotId: SlotId; readonly role: Role }
  | { readonly kind: 'describe'; readonly slotId: SlotId; readonly text: string }
  /** FRM1-MOT: the camera's move the person picked; null is "I don't know". */
  | { readonly kind: 'setMotion'; readonly slotId: SlotId; readonly motion: CameraMotion | null }
  | { readonly kind: 'notText'; readonly overlayIds: readonly Id<'TextOverlay'>[] }
  | { readonly kind: 'tempo'; readonly factor: 0.5 | 2 }
  | { readonly kind: 'dismiss'; readonly target: DoubtTarget; readonly reason: DoubtReason }
  /** DSG1-READ: "Not a graphic" (false) and its restore (true). */
  | { readonly kind: 'setGraphic'; readonly overlayId: Id<'TextOverlay'>; readonly graphic: boolean }
  /** DSG1-READ: a graphic's brief as the person writes it. */
  | { readonly kind: 'editBrief'; readonly overlayId: Id<'TextOverlay'>; readonly brief: GraphicBriefPatch }
  /** The reel's sound credit, from the review's "Add the credit" (null clears it). */
  | { readonly kind: 'soundCredit'; readonly credit: SoundCredit | null }
  /** A "Tell Taalcut" proposal the person accepted: its command, made on the head on screen now. */
  | { readonly kind: 'proposal'; readonly proposal: TemplateProposal };

export type ReviewEditKind = ReviewEdit['kind'];
