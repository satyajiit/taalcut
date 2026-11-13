// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX round 1's additions to the smart-card protocol, in one place (index.ts sits at its line limit): live reads that
 * tell "gone" from "broken" (useTimelineRead, useRenderRead, useTemplateRead, LiveReadLine), answers whose failure
 * stays on the card (useAnswer, AnswerFailureLine, DecideOutcome), and the transcript's one marigold primary
 * (PrimaryHolderProvider, useHoldsPrimary, usePrimaryVariant).
 */
export type { DecideOutcome } from './card-actions';
export { useRenderRead, useTemplateRead, useTimelineRead } from './card-data';
export {
  isReadFailure,
  liveValue,
  type CardReadFailure,
  type LiveRead,
  type LiveReadState,
} from './live-read';
export { LiveReadLine, type LiveReadLineProps } from './live-read-line';
export { PrimaryHolderProvider, useHoldsPrimary, useInTranscript, usePrimaryVariant } from './primary-holder';
export {
  AnswerFailureLine,
  useAnswer,
  type AnswerFailure,
  type Answering,
  type DecideOptions,
} from './use-answer';
