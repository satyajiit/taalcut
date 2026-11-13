// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A graphic is a composition the Designer made (HFW1): its commands, its tools and how it is timed. */
export { createCompositionCommands, type CompositionCommandDeps, type GraphicReceipt } from './commands';
export { compositionToolModule, type CompositionToolDeps } from './tools';
export { findPhrase, phraseTokens, type TimedWord } from './phrase-match';
export {
  captionWords,
  LEAD_FRAMES,
  resolveTiming,
  slotStarts,
  timelineFrames,
  transcriptWords,
  type ResolvedTiming,
  type TimingContext,
} from './timing';
export { showProposals, timingContextOf } from './timing-context';
