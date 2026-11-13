// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Named video effects that can be tagged onto a chat message from the
 * Composer's Effects CTA (single or multiple). When tagged as `{ kind: 'effect' }`
 * selection chips, the agent pre-loads their required tools and applies the
 * camera framing, transitions, captions or sound hits, or asks the Designer for
 * the graphic (`graphics.design`), which it writes as a HyperFrames composition.
 */
import '../basics/zod-config';
import { z } from 'zod';

export const CHAT_EFFECT_CATEGORIES = ['graphics', 'camera', 'transitions', 'captions'] as const;
export type ChatEffectCategory = (typeof CHAT_EFFECT_CATEGORIES)[number];

export const CHAT_EFFECT_IDS = [
  // HyperFrames + Motionmaxxing + One-Take GSAP motion graphics overlays
  'kineticTitle',
  'blurResolve',
  'maskReveal',
  'oversizeDrop',
  'flipReveal',
  'wordSwap',
  'staccatoHit',
  'lowerThird',
  'callout',
  'animatedList',
  'counter',
  'barChart',
  'callToAction',
  // Camera & framing effects
  'lockedOn',
  'punchIn',
  'zoomThrough',
  'blurBackdrop',
  'kenBurns',
  // Seam, pacing & cut transitions
  'oneTakeFlow',
  'rhythmContrast',
  'whipPan',
  'flashCut',
  'zoomCut',
  'slideFlow',
  // Captions & sound hits
  'popCaptions',
  'boxCaptions',
  'cutHits',
] as const;

export const chatEffectIdSchema = z.enum(CHAT_EFFECT_IDS);
export type ChatEffectId = z.output<typeof chatEffectIdSchema>;

export interface ChatEffectSpec {
  readonly id: ChatEffectId;
  readonly category: ChatEffectCategory;
  readonly label: string;
  readonly toolNames: readonly string[];
  readonly instruction: string;
}

export const CHAT_EFFECT_SPECS: Readonly<Record<ChatEffectId, ChatEffectSpec>> = {
  kineticTitle: {
    id: 'kineticTitle',
    category: 'graphics',
    label: 'Kinetic title',
    toolNames: ['timeline.get', 'graphics.list', 'graphics.design'],
    instruction:
      "Ask the Designer for a kinetic title (`graphics.design`: a `request` saying the hook's words rise in word by word with a snappy feel and fade out, and the `phrase` someone says it with), clear of faces and the bottom caption rail.",
  },
  blurResolve: {
    id: 'blurResolve',
    category: 'graphics',
    label: 'Blur-resolve title',
    toolNames: ['timeline.get', 'graphics.list', 'graphics.design'],
    instruction:
      "Ask the Designer for a blur-resolve title (`graphics.design`: a `request` saying the words focus in place from a soft defocus, word by word, without competing with the camera's motion, and the `phrase` they land on).",
  },
  maskReveal: {
    id: 'maskReveal',
    category: 'graphics',
    label: 'Mask clip wipe',
    toolNames: ['timeline.get', 'graphics.list', 'graphics.design'],
    instruction:
      'Ask the Designer for a clip-mask title (`graphics.design`: a `request` saying the words slice into view through a crisp clip-edge wipe and leave the same way, and the `phrase` they land on).',
  },
  oversizeDrop: {
    id: 'oversizeDrop',
    category: 'graphics',
    label: 'Oversize slam',
    toolNames: ['timeline.get', 'graphics.list', 'graphics.design'],
    instruction:
      'Ask the Designer for a crash-in title (`graphics.design`: a `request` saying the thesis hook drops in oversize with fast travel and a soft landing, and the `phrase` it lands on).',
  },
  flipReveal: {
    id: 'flipReveal',
    category: 'graphics',
    label: '3D char flip',
    toolNames: ['timeline.get', 'graphics.list', 'graphics.design'],
    instruction:
      'Ask the Designer for a per-letter flip title (`graphics.design`: a `request` saying the letters flip into place one after another with an overlap, and the `phrase` they land on).',
  },
  wordSwap: {
    id: 'wordSwap',
    category: 'graphics',
    label: 'Word swap',
    toolNames: ['timeline.get', 'graphics.list', 'graphics.design'],
    instruction:
      'Ask the Designer for a word swap (`graphics.design`: a `request` naming the line that stays and the contrasting or punchline words that cycle under it, each on the word someone says, and the `phrase` it starts on).',
  },
  staccatoHit: {
    id: 'staccatoHit',
    category: 'graphics',
    label: 'Staccato word hits',
    toolNames: ['timeline.get', 'graphics.list', 'graphics.design', 'sfx.addHits'],
    instruction:
      'Ask the Designer for a rapid staccato word-hit sequence (`graphics.design`: a `request` naming the words that hit one after another on the speech, and the `phrase` it starts on), paired with downbeat sound hits (`sfx.addHits` with `density: "downbeats", style: "punchy"`).',
  },
  lowerThird: {
    id: 'lowerThird',
    category: 'graphics',
    label: 'Lower third',
    toolNames: ['timeline.get', 'graphics.list', 'graphics.design'],
    instruction:
      'Ask the Designer for a speaker or topic badge (`graphics.design`: a `request` naming the title and subtitle, sliding in smoothly and fading out, and the `phrase` of the introduction), clear of the captions.',
  },
  callout: {
    id: 'callout',
    category: 'graphics',
    label: 'Callout pointer',
    toolNames: ['timeline.get', 'graphics.list', 'graphics.design'],
    instruction:
      'Ask the Designer for a callout (`graphics.design`: a `request` naming the words and the subject or detail it marks with a drawn arrow or circle, and the `phrase` or `target` it comes on with).',
  },
  animatedList: {
    id: 'animatedList',
    category: 'graphics',
    label: 'Animated checklist',
    toolNames: ['timeline.get', 'graphics.list', 'graphics.design'],
    instruction:
      'Ask the Designer for an animated list (`graphics.design`: a `request` naming the items, each sliding in as it is spoken, and the `phrase` of the first).',
  },
  counter: {
    id: 'counter',
    category: 'graphics',
    label: 'Stat counter',
    toolNames: ['timeline.get', 'graphics.list', 'graphics.design'],
    instruction:
      'Ask the Designer for a stat card (`graphics.design`: a `request` naming the number it counts to, its unit and how it pops in, and the `phrase` someone says the number with).',
  },
  barChart: {
    id: 'barChart',
    category: 'graphics',
    label: 'Data bars',
    toolNames: ['timeline.get', 'graphics.list', 'graphics.design'],
    instruction:
      'Ask the Designer for a bar chart (`graphics.design`: a `request` naming the bars, their labels and values, growing in from the centre and fading out, and the `phrase` or `at` it comes on).',
  },
  callToAction: {
    id: 'callToAction',
    category: 'graphics',
    label: 'End CTA card',
    toolNames: ['timeline.get', 'graphics.list', 'graphics.design'],
    instruction:
      'Ask the Designer for an end call-to-action card (`graphics.design`: a `request` naming the words and the action, follow or subscribe, popping in with a bounce, and the closing `at` or `phrase`).',
  },
  lockedOn: {
    id: 'lockedOn',
    category: 'camera',
    label: 'Locked-on face',
    toolNames: ['timeline.get', 'timeline.setReframe'],
    instruction:
      'Apply face-locked 9:16 subject framing (`timeline.setReframe` with `reframe: { mode: "auto" }` or `{ mode: "subject" }`) on the target video clip(s) so the camera stays locked on the speaker.',
  },
  punchIn: {
    id: 'punchIn',
    category: 'camera',
    label: 'Punch-in zoom',
    toolNames: ['timeline.get', 'timeline.setReframe', 'timeline.planCleanup', 'timeline.applyCleanup'],
    instruction:
      'Apply a punch-in emphasis zoom (`timeline.setReframe` with `reframe: { mode: "subject", scale: 1.12 }` on the target clip, or `timeline.planCleanup` + `timeline.applyCleanup` for emphasis punch-ins across speech).',
  },
  zoomThrough: {
    id: 'zoomThrough',
    category: 'camera',
    label: 'Zoom-through carry',
    toolNames: [
      'timeline.get',
      'timeline.setReframe',
      'timeline.planEnergyCurve',
      'timeline.applyEnergyCurve',
      'sfx.addHits',
    ],
    instruction:
      'Carry the camera through the cut boundary (`timeline.setReframe` with `reframe: { mode: "subject", scale: 1.15 }` paired with `timeline.planEnergyCurve` + `timeline.applyEnergyCurve` and `sfx.addHits`) so the incoming beat grows continuously out of the outgoing frame.',
  },
  blurBackdrop: {
    id: 'blurBackdrop',
    category: 'camera',
    label: 'Blur backdrop',
    toolNames: ['timeline.get', 'timeline.setReframe'],
    instruction:
      'Reframe the target clip(s) with a blurred ambient background pad (`timeline.setReframe` with `reframe: { mode: "blurPad" }`) for vertical cinema framing.',
  },
  kenBurns: {
    id: 'kenBurns',
    category: 'camera',
    label: 'Ken Burns drift',
    toolNames: ['timeline.get', 'timeline.setReframe', 'timeline.fillGap'],
    instruction:
      'Apply a smooth `kenBurns` camera drift (`timeline.fillGap` with `stillMotion: "kenBurns"` on image gaps, or `timeline.setReframe` with `reframe: { mode: "auto", scale: 1.08 }` on video clips).',
  },
  oneTakeFlow: {
    id: 'oneTakeFlow',
    category: 'transitions',
    label: 'One-take flow',
    toolNames: [
      'timeline.get',
      'timeline.planCleanup',
      'timeline.applyCleanup',
      'timeline.planEnergyCurve',
      'timeline.applyEnergyCurve',
      'timeline.setReframe',
      'graphics.design',
      'sfx.addHits',
    ],
    instruction:
      'Orchestrate an unbroken one-take continuous flow across the timeline: tighten dead pauses (`timeline.planCleanup` + `timeline.applyCleanup`), shape a non-uniform energy curve with a burst and a calm pre-climax rest (`timeline.planEnergyCurve` + `timeline.applyEnergyCurve`), bridge cut boundaries with carried camera scale (`timeline.setReframe`) and a phrase-spanning graphic the Designer makes (a `graphics.design` request), and unify seams with subtle whoosh/foley hits (`sfx.addHits`).',
  },
  rhythmContrast: {
    id: 'rhythmContrast',
    category: 'transitions',
    label: 'Burst & rest pacing',
    toolNames: [
      'timeline.get',
      'timeline.planEnergyCurve',
      'timeline.applyEnergyCurve',
      'timeline.resyncBeats',
    ],
    instruction:
      'Break uniform metronome shot lengths by shaping a high-contrast rhythm curve (`timeline.planEnergyCurve` + `timeline.applyEnergyCurve` + `timeline.resyncBeats`) that alternates a fast multi-cut burst with a calm 1 s stillness before the payoff.',
  },
  whipPan: {
    id: 'whipPan',
    category: 'transitions',
    label: 'Whip pan',
    toolNames: ['timeline.get', 'timeline.setTransition', 'sfx.addHits'],
    instruction:
      'Whip-pan through the cut (`timeline.setTransition` with `kind: "whip"` on the clip before it, `edge: "end"`; on every cut when no clip is selected) and pair it with whoosh hits (`sfx.addHits`).',
  },
  flashCut: {
    id: 'flashCut',
    category: 'transitions',
    label: 'Flash & beat cut',
    toolNames: ['timeline.get', 'timeline.resyncBeats', 'timeline.setTransition', 'sfx.addHits'],
    instruction:
      'Snap every cut cleanly onto the beat grid (`timeline.resyncBeats`), flash white through the downbeat cuts (`timeline.setTransition` with `kind: "flash"`) and layer punchy impact hits on them (`sfx.addHits` with `style: "punchy"`).',
  },
  zoomCut: {
    id: 'zoomCut',
    category: 'transitions',
    label: 'Zoom cut',
    toolNames: ['timeline.get', 'timeline.setTransition', 'timeline.setReframe'],
    instruction:
      'Zoom through the cut (`timeline.setTransition` with `kind: "zoom"`; `direction: "down"` zooms out), and punch in on the incoming clip (`timeline.setReframe` with `scale: 1.12`) when it needs more.',
  },
  slideFlow: {
    id: 'slideFlow',
    category: 'transitions',
    label: 'Directional slide',
    toolNames: ['timeline.get', 'timeline.setTransition', 'sfx.addHits'],
    instruction:
      'Slide through the cuts in one consistent direction (`timeline.setTransition` with `kind: "slide"` on the clip before each cut, `edge: "end"`), following the HyperFrames Vector Law (one directional current), paired with cut whooshes (`sfx.addHits`).',
  },
  popCaptions: {
    id: 'popCaptions',
    category: 'captions',
    label: 'Pop captions',
    toolNames: ['captions.setEnabled', 'captions.setStyle'],
    instruction:
      'Enable captions (`captions.setEnabled` with `enabled: true`) and set the caption style to bold word-pop (`captions.setStyle` with `style: { highlight: "pop", font: "anton", weight: 400, sizePx: 96, letterCase: "upper", maxWords: 3 }`).',
  },
  boxCaptions: {
    id: 'boxCaptions',
    category: 'captions',
    label: 'Box captions',
    toolNames: ['captions.setEnabled', 'captions.setStyle'],
    instruction:
      'Enable captions (`captions.setEnabled` with `enabled: true`) and set the caption style to high-contrast pill boxes (`captions.setStyle` with `style: { highlight: "box", font: "montserrat", weight: 700, sizePx: 64, background: { color: "#000000", opacity: 0.7, paddingPx: 12, radiusPx: 8 }, maxWords: 5 }`).',
  },
  cutHits: {
    id: 'cutHits',
    category: 'captions',
    label: 'Cut whoosh & hits',
    toolNames: ['timeline.get', 'sfx.addHits', 'sfx.generateHit'],
    instruction:
      'Layer rhythmic sound design on cuts (`sfx.addHits` with `density: "everyCut"` or `"downbeats"` and `style: "punchy"`) to punctuate visual transitions with whooshes, risers, and impacts.',
  },
};

