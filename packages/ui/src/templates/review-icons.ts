// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The review's glyphs (BRK1-REV), one per thing and per action, from the icon registry where it has them. The few it
 * lacks are named here once, for the registry to take in (`_orch/brk1/specs/rev-requests.md`): the review never
 * picks a glyph at the call site.
 */
import {
  ChevronLeft,
  ChevronRight,
  ArchiveRestore,
  CircleDashed,
  Combine,
  EyeOff,
  MoveHorizontal,
  RemoveFormatting,
  Repeat1,
  Video,
} from 'lucide-react';
import { CONCEPT_ICONS, VERB_ICONS } from '../icons/concepts';

export const REVIEW_ICONS = {
  /** "Review the reel": the play glyph, as the export's "Review and export". */
  review: VERB_ICONS.play,
  play: VERB_ICONS.play,
  pause: VERB_ICONS.pause,
  /** "Looks right" approves: the approve tick. */
  looksRight: VERB_ICONS.approve,
  /** Something to check: DESIGN's dashed circle, in warning yellow. */
  toCheck: CircleDashed,
  approved: CONCEPT_ICONS.success,
  previous: ChevronLeft,
  next: ChevronRight,
  /** Loop the selected slot. */
  loop: Repeat1,
  addCut: VERB_ICONS.trim,
  /** Move the cut: its handle slides along the strip. */
  moveCut: MoveHorizontal,
  rename: VERB_ICONS.rename,
  checkAgain: VERB_ICONS.checkAgain,
  notCut: Combine,
  drop: VERB_ICONS.delete,
  describe: VERB_ICONS.edit,
  tempo: CONCEPT_ICONS.beat,
  /** Add the credit: the reel's sound. */
  credit: CONCEPT_ICONS.music,
  notText: RemoveFormatting,
  /** FRM1-MOT: the camera's move (a slot's pan, tilt, push-in…), for the registry to take in. */
  cameraMove: Video,
  /** DSG1-READ: "Not a graphic" leaves it out of made videos; Restore puts it back. For the registry to take in. */
  notGraphic: EyeOff,
  restore: ArchiveRestore,
  text: CONCEPT_ICONS.text,
  slot: CONCEPT_ICONS.slot,
  reel: CONCEPT_ICONS.reel,
  undo: VERB_ICONS.undo,
  more: VERB_ICONS.more,
  done: VERB_ICONS.approve,
  send: VERB_ICONS.send,
} as const;
