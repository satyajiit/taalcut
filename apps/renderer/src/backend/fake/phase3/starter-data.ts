// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* eslint-disable lingui/no-unlocalized-strings -- starter ids and slot intents: template data, never shown as UI copy */

/**
 * The bundled starter templates (P3-B3, P3-L2, docs/onboarding.md section 9) as the templates lane ships them,
 * eight for each UI language:
 * structure only (D9), each a hub structure at 1080×1920, 30 fps, with a synthetic beat map at its tempo. The
 * fake serves them from `templates.starters` and forks one on `template.addStarter`.
 */
import type { AppLocale, FormatId, HubStructure, StarterNeed, StarterSummary } from '@taalcut/core';
import type { SlotPlan, TemplatePlan } from '../templates/template-plans';

const FPS = { num: 30, den: 1 } as const;
const TRACKER = { num: 50, den: 1 } as const;
const at = (frames: number) => ({ value: frames, rate: FPS });

type Role = SlotPlan['role'];

interface StarterPlan {
  readonly id: string;
  readonly formatId: FormatId;
  readonly needs: StarterNeed;
  /** The UI languages it is offered in ('all': every one). */
  readonly locales: 'all' | readonly AppLocale[];
  /** null: speech-led, no beat map; slots are then in seconds. */
  readonly bpm: number | null;
  /** Slot lengths in beats (or seconds when bpm is null), with their role. */
  readonly slots: readonly (readonly [length: number, role: Role])[];
  /** Spoken words carry it (captions on). */
  readonly voice?: boolean;
}

const run = (count: number, beats: number, role: Role = 'body') =>
  Array.from({ length: count }, () => [beats, role] as const);

export const STARTER_PLANS: readonly StarterPlan[] = [
  // Six for every language, then two of each language's own (packages/templates' STARTER_CATALOGUE).
  {
    id: 'weekend-trip',
    formatId: 'vlog',
    needs: 'many-clips',
    locales: 'all',
    bpm: 112,
    // 56 beats: 30 s.
    slots: [[4, 'hook'], ...run(9, 4), [8, 'peak'], [8, 'outro']],
  },
  {
    id: 'my-day',
    formatId: 'dayInTheLife',
    needs: 'day-clips',
    locales: 'all',
    bpm: 100,
    // 50 beats: 30 s.
    slots: [[6, 'hook'], ...run(7, 5), [5, 'peak'], [4, 'outro']],
  },
  {
    id: 'quick-tip',
    formatId: 'talkingHead',
    needs: 'talking',
    locales: 'all',
    bpm: 90,
    // 45 beats: 30 s, the talking clip and four punch-ins.
    slots: [[9, 'hook'], ...run(4, 9)],
    voice: true,
  },
  {
    id: 'product-in-30-seconds',
    formatId: 'ugcAd',
    needs: 'product',
    locales: 'all',
    bpm: 120,
    slots: [[4, 'hook'], ...run(2, 6), [8, 'peak'], [8, 'peak'], ...run(2, 8), [6, 'outro']],
  },
  {
    id: 'glow-up',
    formatId: 'beforeAfter',
    needs: 'two-clips',
    locales: 'all',
    bpm: 120,
    slots: [
      [12, 'hook'],
      [6, 'peak'],
      [12, 'outro'],
    ],
  },
  {
    id: 'best-moments',
    formatId: 'highlightReel',
    needs: 'many-clips',
    locales: 'all',
    bpm: 128,
    // 32 beats: 15 s, cut on alternating two- and three-beat clips.
    slots: [
      [4, 'hook'],
      ...run(4, 2).flatMap((two) => [two, [3, 'body'] as const]),
      [3, 'peak'],
      [5, 'outro'],
    ],
  },
  {
    id: 'recipe-in-30-seconds',
    formatId: 'tutorial',
    needs: 'steps',
    locales: ['en'],
    bpm: 100,
    slots: [[6, 'hook'], ...run(3, 12), [8, 'outro']],
  },
  {
    id: 'podcast-moment',
    formatId: 'podcastClip',
    needs: 'conversation',
    locales: ['en'],
    bpm: null,
    slots: [[30, 'body']],
    voice: true,
  },
  {
    id: 'festival-vlog',
    formatId: 'vlog',
    needs: 'many-clips',
    locales: ['hi'],
    bpm: 110,
    // 82 beats: 45 s.
    slots: [[6, 'hook'], ...run(14, 4), [10, 'peak'], [10, 'outro']],
  },
  {
    id: 'wedding-highlights',
    formatId: 'highlightReel',
    needs: 'many-clips',
    locales: ['hi'],
    bpm: 128,
    slots: [[8, 'hook'], ...run(10, 4), [8, 'peak'], [8, 'outro']],
  },
  {
    id: 'receta-rapida',
    formatId: 'tutorial',
    needs: 'steps',
    locales: ['es'],
    bpm: 100,
    slots: [[6, 'hook'], ...run(3, 12), [8, 'outro']],
  },
  {
    id: 'golazos',
    formatId: 'highlightReel',
    needs: 'many-clips',
    locales: ['es'],
    bpm: 140,
    slots: [[4, 'hook'], ...run(10, 2), [8, 'peak'], [3, 'outro']],
  },
  {
    id: 'role-de-fim-de-semana',
    formatId: 'vlog',
    needs: 'many-clips',
    locales: ['pt-BR'],
    bpm: 112,
    slots: [[4, 'hook'], ...run(9, 4), [8, 'peak'], [8, 'outro']],
  },
  {
    id: 'receita-rapida',
    formatId: 'tutorial',
    needs: 'steps',
    locales: ['pt-BR'],
    bpm: 100,
    slots: [[6, 'hook'], ...run(3, 12), [8, 'outro']],
  },
];

/** Frames per slot length unit at 30 fps. */
const framesPer = (plan: StarterPlan) => (plan.bpm ? (60 / plan.bpm) * 30 : 30);

export function starterStructure(plan: StarterPlan): HubStructure {
  const unit = framesPer(plan);
  let start = 0;
  let beat = 0;
  const slots = plan.slots.map(([length, role]) => {
    const duration = Math.round(length * unit);
    const slot: HubStructure['slots'][number] = {
      role,
      name: null,
      start: at(start),
      duration: at(duration),
      intent: {
        text: role === 'hook' ? 'Opening shot that grabs attention' : 'A clip that moves the story on',
        shotType: null,
        motion: null,
        subject: null,
        people: null,
        place: null,
        energy: role === 'peak' ? 0.8 : role === 'hook' ? 0.7 : 0.45,
      },
      beatAnchor: plan.bpm ? { beatIndex: beat, offset: at(0) } : null,
      transitionIn: null,
      speedRamp: null,
    };
    start += duration;
    beat += length;
    return slot;
  });
  const lengths = slots.map((slot) => slot.duration.value).sort((a, b) => a - b);
  const beats = plan.bpm ? Math.floor(start / unit) : 0;
  const unitsPerBeat = plan.bpm ? (60 / plan.bpm) * 50 : 0;
  return {
    canvas: { width: 1080, height: 1920, rate: FPS },
    duration: at(start),
    slots,
    beatMap: plan.bpm
      ? {
          rate: TRACKER,
          beats: Array.from({ length: beats }, (_, i) => ({
            value: Math.round(i * unitsPerBeat),
            rate: TRACKER,
          })),
          downbeats: Array.from({ length: Math.ceil(beats / 4) }, (_, i) => i * 4),
          bpm: plan.bpm,
          beatsPerBar: 4,
          confidence: 1,
          source: 'format',
        }
      : null,
    text: [],
    audio: {
      kind: plan.voice ? 'voice' : 'music',
      loudnessLufs: null,
      speechCoverage: plan.voice ? 0.9 : null,
      speechLanguage: null,
    },
    pacing: {
      shotCount: slots.length,
      meanShot: at(Math.round(start / slots.length)),
      medianShot: at(lengths[Math.floor(lengths.length / 2)] ?? 0),
      shortestShot: at(lengths[0] ?? 0),
      longestShot: at(lengths.at(-1) ?? 0),
      hookEnd: at(Math.min(slots[0]?.duration.value ?? 0, 90)),
      cutsOnBeat: plan.bpm ? 1 : null,
    },
  };
}

export const starterSummary = (plan: StarterPlan): StarterSummary => ({
  starterId: plan.id,
  nameKey: `starters.${plan.id}.name`,
  formatId: plan.formatId,
  needs: plan.needs,
  structure: starterStructure(plan),
});

/** The starter's language for its provenance: its own, or English when every language has it. */
export const starterLocale = (plan: StarterPlan): AppLocale =>
  plan.locales === 'all' ? 'en' : (plan.locales[0] ?? 'en');

/**
 * The starters for one UI language, in the order the picker shows them: with `forLibrary`, the best fit for what
 * the library holds first (many clips: a vlog; one long talking clip: a tip to camera), as the templates service
 * decides.
 */
export function startersFor(
  library: { clips: number },
  input: { readonly locale: AppLocale; readonly forLibrary: boolean },
): StarterSummary[] {
  const all = STARTER_PLANS.filter(
    (plan) => plan.locales === 'all' || plan.locales.includes(input.locale),
  ).map(starterSummary);
  if (!input.forLibrary) return all;
  const best = library.clips === 1 ? 'quick-tip' : library.clips === 2 ? 'glow-up' : 'weekend-trip';
  return [...all.filter((s) => s.starterId === best), ...all.filter((s) => s.starterId !== best)];
}

/** A starter as the fake's templates store keeps it once forked (the fake's own template shape). */
export function starterTemplatePlan(plan: StarterPlan, n: number, name: string): TemplatePlan {
  const unit = framesPer(plan);
  return {
    n,
    name,
    platform: null,
    bpm: plan.bpm,
    beatFrames: Math.round(unit),
    scene: n % 7,
    language: null,
    overlays: [],
    slots: plan.slots.map(([length, role]) => ({
      beats: length,
      role,
      text: role === 'hook' ? 'Opening shot that grabs attention' : 'A clip that moves the story on',
      shotType: null,
      motion: null,
      energy: role === 'peak' ? 0.8 : 0.45,
    })),
  };
}
