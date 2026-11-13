// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `agent.gaps` skill's model-facing prompt (SPEC section 26), versioned with the skill: a change here is a
 * minor version bump of the skill. Not user-facing copy.
 */

/** Bumped with every wording change, together with the skill's version. */
export const GAP_PROMPT_VERSION = '1.4.0';

export const GAP_PROMPT = [
  'Some slots have no shot at all (state "empty"), and some have a clip casting is unsure of (state "weak"). Your',
  'input lists each with the fix to apply (`fix`), the fixes it may get (`fixes`) and why that fix was chosen.',
  'Apply exactly the given fix to every gap in your input, then hand off. Leave every slot not in your input as it is.',
  '',
  '- keep (weak only): the clip stays. Call nothing.',
  "- swap (weak only): call timeline.swapClip with the gap's timelineId, its gapId as clipId, `swapTo` as media",
  '  and from "agent".',
  '- film: an empty slot is on the "film this" list the phone shows already: call nothing. A weak one: call',
  '  timeline.markForFilming with its slotId; its clip stays until the shot is filmed.',
  '- generate: call images.generateForSlot for the slot with the given prompt (you may make it more concrete,',
  "  never a real person's face or likeness, no text or logos). It fills an empty slot with the still; for a weak",
  '  one, put the still in with timeline.swapClip (its asset, shotId null, from "agent").',
  '- stock: search with the given words (stock.search), import the best result (stock.import), and fill the gap',
  '  with the asset it returns (timeline.fillGap; for a weak slot, timeline.swapClip).',
  "- drop: call timeline.dropSlot once for the gap, with the gap's timelineId, its gapId as itemId and mode",
  '  "ripple"; its neighbours take the time on the beat grid.',
  '- borrow: another shot gives its clip to this gap. First call timeline.swapClip with `borrow.clipId` as clipId',
  '  and `borrow.instead` as media (from "agent"): that shot gets its new clip. Then put `swapTo` in this gap: for an',
  '  empty one timeline.fillGap with media { kind "video", assetId, shotId }; for a weak one timeline.swapClip with',
  '  its gapId as clipId (from "agent").',
  '- reuse: another part of a clip already in the video. Put `swapTo` in this gap from `sourceStart`: for an empty',
  '  one timeline.fillGap with media { kind "video", assetId, shotId, sourceStart }; for a weak one timeline.swapClip',
  '  with its gapId as clipId, `swapTo` as media, sourceStart and from "agent".',
  '',
  'If a fix fails, say so in one line and use film for that gap instead. Hand off every gap of your input, each',
  'with the fixes it was offered and the one you applied (null if none), the number of gaps you put on the film',
  "list, and each timeline's revision after your changes. The user's footage and choices stay as they are.",
  '',
  'With the handoff, tell the creator in one or two short sentences, in their language, what you kept, dropped,',
  'swapped or moved and why (each gap\'s `why`), then stop with no follow-up questions. Say "shot", never "slot"; say "clip", never "asset".',
].join('\n');
