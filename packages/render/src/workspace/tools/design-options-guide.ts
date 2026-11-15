// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `taalcut/design-options` (DSG2): how the Designer finds and makes a job's three options. The method comes from the
 * Hallmark design skill (a point of view before any pixels, type paired on purpose, restraint, variety measured by
 * structure and not by colour, a named list of machine-made tells, a self-critique before handing over), adapted
 * here to motion graphics that sit over moving footage and written in Taalcut's own words. Nothing of the skill's
 * text or files is bundled. It is guidance for a model, read through `workspace.docs`; it holds no design, no look
 * to pick and no list of words: every option is still the model's own composition. One page, so it costs one read.
 */
import type { TaalcutDocsTopic } from './taalcut-docs-topic';

export const DESIGN_OPTIONS_DOC: TaalcutDocsTopic = {
  topic: 'taalcut/design-options',
  text: `# Three options for a graphic: a method

A person will choose between your three. Give them a real choice: three answers to the same question, each one you would defend.

Work one design at a time. Finish the first and place it before you start the second: it is in the video at once, and each later one joins it as another option. Never rewrite a placed design to fix another. A design that still fails after two fixes is dropped: move on to the next.

## 1. A point of view first
Before any markup, answer in a sentence each: what is this moment in the video, who is speaking, what should the viewer feel or know in two seconds? A design is a position on that, not a layout. Then write each option's idea in one line ("the title as a quiet caption that lets the shot lead", "the title as a poster that owns the frame"). If you cannot say what an option believes, it is not ready. The idea line goes to workspace.placeOptions and the person reads it.

## 2. Three positions, not three coats
Variety is measured by structure, never by colour. Pick the three from different families of answer, then check that any two differ on at least two of:
- Type: the voice of the lettering (condensed display, geometric, humanist, rounded; heavy against light; capitals against sentence case).
- Layout: where it holds on to the frame and how it is built (one line or a stack, anchored to an edge or centred, small beside the subject or large across it).
- Motion: how it arrives and leaves (a mask opening, words landing one by one, a slide along one axis, a scale that settles, a rule that draws).
Say the picks before writing: "A: … B: … C: … A and B differ in type and motion". Do not make the second by editing the first's colours, and do not reach for the same safe answer three times. All three keep the same words in the same text variables and the safe rect.

## 3. Type, chosen and paired on purpose
- One voice leads. A second family only as a quiet companion for a second role (a label under a title); never three.
- Commit to contrast between roles: weights far apart (a light against a heavy, not 400 against 600), sizes at a clear ratio (1.5 or more), or case against case. Near-equal roles read as an accident.
- Big display type sits tight (line-height 0.95 to 1.1, tracking at or below zero). Small capitals want open tracking. Keep headlines upright.
- The bundled families are all sans: weight, width, case, spacing and scale carry the character. A condensed face shouts, a rounded one is friendly, a light geometric one is calm. Match the voice to the moment, and let the three options use different voices.
- Words set for other words: layouts must hold a shorter and a longer line (text-wrap: balance, max-width, no measured widths).

## 4. Hierarchy and restraint
- One thing is first. A viewer names the primary element at a glance; at most three levels, usually two.
- One accent, used small (a rule, one word, a mark). Everything else is the lettering and the footage.
- Remove what does not earn its place: boxes, borders, icons, sparkles, extra lines. If the design survives without it, it goes. A plate behind words is a decision the idea needs, never a reflex.

## 5. Contrast against moving footage
The picture under the words changes every frame. Judge each option on its brightest and its darkest still.
- First make the lettering strong enough to stand alone: size and weight before effects.
- Then, only if a still needs it: a soft layered shadow, or a tint shaped to the words. Tint it from the footage's own dark, not pure black; avoid pure white on blown highlights.
- A full-width opaque slab hides the shot. Use a band only when the band is the idea.
- Keep off faces and the subject unless the job asks; stay inside the safe rect.

## 6. Spacing
Use one scale (8, 16, 24, 40, 64, 96 px on a 1080 canvas) and mix its steps: tight inside a lockup, wide between groups. Align to something real: an edge of the safe rect, the subject's line, another graphic. Centre only when the idea is centred; an edge-anchored design often reads as more deliberate. Centre with layout (flex, grid, inset and auto margins), never a CSS transform: the animation owns transform, and lint refuses both on one element.

## 7. Motion that means something
- One arrival, composed: what leads comes first, the rest follows in reading order. Not every element with its own trick.
- A direction needs a reason: along the subject's movement, from the edge it is anchored to, in the order it is read.
- Arrive slowing down, leave faster than you came (about three quarters of the entrance) and speeding up. Hold still while it is read.
- If you cannot say what a movement tells the viewer, cut it.
- Time the arrival to the words or the beat it belongs to (the brief's moments).

## 8. What makes it look machine-made
Each of these is a default, not a decision. One is enough to spoil an option:
- White bold centred words with a black drop shadow, chosen because nothing was chosen.
- Gradient-filled lettering; purple-to-blue or pink-to-orange gradients; neon glow.
- A frosted or rounded dark card behind every title; a pill with an emoji.
- Every word bouncing or popping; overshoot on everything; the same fade-up on each element; letters typing out a headline; a loop that never rests.
- Long lines in wide-tracked capitals; two sizes that almost match; three weights of one family doing three jobs.
- Decoration that says nothing: orbs, blobs, sparkles, confetti, stock icons.
- Shadows on everything; pure black on pure white.
- Three options that are one layout in three palettes.
- Invented numbers, names or claims; trailer melodrama; trailing dots.

## 9. Before you place each one
Look at the design's stills and score it 1 to 5: point of view (does it take a position?), hierarchy (is one thing first?), execution (spacing, edges, contrast on both stills, landing), specificity (does it belong to this video, or to any?), restraint (is anything left to remove?), variety (how far is it from the ones placed?). Anything under 3 gets one revision, then place it. If you cannot see the stills, place it once lint passes: the placing tool draws it where it plays. The scores stay with you: they never go in the video or the handoff. Make your strongest idea first: it is in the video until the person chooses.`,
};
