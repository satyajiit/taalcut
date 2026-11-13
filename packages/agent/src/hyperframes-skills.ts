// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HyperFrames + GSAP motion doctrine and chat effect routing for the agent.
 *
 * Distills the core composition, choreography, and vertical reel skills from
 * HyperFrames (`motion-doctrine`, `cut-the-curve`, `captions-overlay`,
 * `seam-craft`, `types/vertical`), Motionmaxxing (`SKILL.md`, `motion.md`,
 * `type.md`, `transitions.md`, `slop.md`), and short-form video effects into
 * operating rules and deterministic tool routing when users tag effects in chat.
 */
import { CHAT_EFFECT_SPECS, type ChatEffectId, type SelectionChip } from '@taalcut/core';
import type { ToolCatalogueEntry } from '@taalcut/tools';

export const HYPERFRAMES_MOTION_SKILLS = `# HyperFrames & Motionmaxxing motion doctrine

- Graphics are designed, never picked from a list: every new graphic and every change to a graphic's look is a design request (\`graphics.design\` with the person's words, where it comes on and what it is about); the Designer writes it as a HyperFrames composition. Say the look, the motion and the timing in words in the request.
- Vector Law (directional current): pick one dominant directional current per sequence (horizontal or vertical) and commit to it. Never ping-pong opposite directional transitions back-to-back.
- One-Take continuous carry & seam choreography (\`cut-the-curve\`, Motionmaxxing \`T1\`/\`T6\`, \`oneTakeFlow\`): treat every boundary between beats as a carried handoff rather than a slide replacement. Cut on motion at peak velocity, bridge seams with zoom-through scale continuity (\`timeline.setReframe\`) or a phrase-spanning overlay (a \`graphics.design\` request), and pair transitions with room-consistent whoosh/foley hits (\`sfx.addHits\`).
- Non-metronomic rhythm (burst vs. rest): never cut every shot to the same uniform length. Shape the timeline's energy curve (\`timeline.planEnergyCurve\` + \`timeline.applyEnergyCurve\`) so rapid multi-cut bursts contrast with a deliberate 0.6–1.5 s calm breath before the climax cut, and never end two consecutive shots the same way.
- Land decelerates, leave accelerates (Motionmaxxing measured curves): entries put 60–72% of travel in the first 4–8 frames and decelerate with a soft tail, while exits accelerate off-frame. Spend overshoot once per sequence (or on the closing call to action) rather than bouncing every element.
- Move, don't fade (Motionmaxxing \`R1.6\` & \`type.md\`): elements arrive by moving, cutting in through a mask, or optical focus when the camera is already moving—never default to plain opacity dissolves everywhere.
- Whole-word speech cadence (\`captions-overlay\` & Motionmaxxing \`type.md\`): time a graphic to the phrase someone says (\`graphics.design\`'s \`phrase\`) whenever a transcript exists, reveal hooks and claims word by word (never typewriter-style char-by-char headlines), and land each item of a list on its spoken syllable.
- Meaning on the word, /humanizer pass & anti-slop rules (Motionmaxxing \`SKILL.md\` & \`slop.md\`): act out the meaning on a single hero word; run a strict /humanizer pass on all on-screen copy and voiceover scripts so they read like a real person talking to friends/family in natural sentence case—ban movie-trailer melodrama and dramatic fragments ("At last. A place of our own.", "I finally made it.", "But today... we're home."), trailing ellipses ("..."), generic AI slogan triplets ("Faster. Smarter. Yours."), "Not just X, it's Y" contrasts, em dashes (—), poetic clichés ("Every corner feels different when you can call it yours", "I kept dreaming of this day"), and invented stats; never add page-chrome HUD clutter; keep end CTA holds crisp (\`<= 1.4 s\`). When wide 16:9 landscape clips play inside a portrait 9:16 layout, include a crisp "Rotate your screen" phone-tilt animation in the opening 0–2.5 s.
- Vertical 9:16 safe-zone & rail discipline: keep titles, callouts, counters and charts in the upper or middle third clear of faces and the bottom caption rail; never stack two text-heavy graphics simultaneously.
- Covering or removing unwanted marks / watermarks on a slot: when the creator asks to remove, hide, black out, or cover a watermark, handle, or unwanted mark on a slot or dark intro card, do not refuse—either remove the overlay item (\`timeline.editText\` with \`remove: true\` or \`graphics.remove\`), place a solid matching black box/backdrop (\`#000000\`) over that region for that slot's duration in the HyperFrames composition (\`workspace.patch\` / \`workspace.write\` + \`workspace.replace\` or \`graphics.design\`), or crop it out with \`timeline.setReframe\`.
- Tagged chat effects: when the user selects one or more \`effect\` tags in chat, apply every requested effect to the target clip, range, or active timeline before finishing the run.`;

const MOTION_FAMILIES: ReadonlySet<string> = new Set(['graphics', 'timeline', 'captions', 'sfx']);

/** True when the tool catalogue includes video editing / motion tools that benefit from HyperFrames doctrine. */
export function hasMotionTools(catalogue: readonly ToolCatalogueEntry[]): boolean {
  return catalogue.some((entry) => MOTION_FAMILIES.has(entry.family));
}

export function isEffectChip(
  chip: SelectionChip,
): chip is Extract<SelectionChip, { readonly kind: 'effect' }> {
  return chip.kind === 'effect';
}

export function effectIdsFromSelections(selections: readonly SelectionChip[] | undefined): ChatEffectId[] {
  if (!selections || selections.length === 0) return [];
  const seen = new Set<ChatEffectId>();
  for (const chip of selections) {
    if (isEffectChip(chip)) seen.add(chip.effectId);
  }
  return [...seen];
}

export function effectSelectionLines(selections: readonly SelectionChip[]): string[] {
  return effectIdsFromSelections(selections).map((effectId) => {
    const spec = CHAT_EFFECT_SPECS[effectId];
    return `- effect "${spec.label}" (${spec.id}): ${spec.instruction}`;
  });
}

export function effectToolsFor(selections: readonly SelectionChip[] | undefined): string[] {
  const tools = new Set<string>();
  for (const effectId of effectIdsFromSelections(selections)) {
    for (const tool of CHAT_EFFECT_SPECS[effectId].toolNames) {
      tools.add(tool);
    }
  }
  return [...tools];
}
