// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * planQa: what QA should find in a render of this plan (SPEC section 2,
 * qa-gate.md "Intended ranges"). Pure; written next to the composition so
 * QA checks the file against what was meant, not against guesses.
 */
import { mergeSpans as merge, RationalTime, type ExportPreset } from '@taalcut/core';
import { popWindows, wordSpans } from '../captions/pop';
import { applyMatrix, visualGradeMatrix } from '../grade/clip-grade';
import type { QaAudioWindow, QaPlan } from '../types';
import type { PlannedVisual, RenderPlan } from './types';
import { authoredQaGraphics } from '../authored/qa-plan';

/** avSync looks at no more than this many windows (qa-gate.md). */
export const MAX_AUDIO_WINDOWS = 12;

const DIP_EFFECTS = new Set(['dipToBlack']);

/** Whether a clip's colour grade intentionally darkens mid-grey into the dark-intro range (luma ≤ 0.35). */
function isDarkVisual(visual: PlannedVisual): boolean {
  if (!visual.enabled) return false;
  const matrix = visualGradeMatrix(visual.grades ?? []);
  if (!matrix) return false;
  const [r, g, b] = applyMatrix(matrix, [0.5, 0.5, 0.5]);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b <= 0.35;
}

function framesOf(seconds: number, plan: RenderPlan): number {
  return Math.round((seconds * plan.rate.num) / plan.rate.den);
}

function audioWindows(plan: RenderPlan): QaAudioWindow[] {
  const windows: QaAudioWindow[] = [];
  const skip = framesOf(0.1, plan);
  const second = framesOf(1, plan);
  for (const clip of plan.audio) {
    const start = clip.span.start + skip;
    const frames = Math.min(second, clip.span.end - start);
    if (frames >= framesOf(0.25, plan))
      windows.push({ sourceId: clip.id, kind: 'clip', startFrame: start, frames });
  }
  if (plan.music.path !== 'platformSound' && plan.music.path !== 'none') {
    const kind = plan.music.path === 'ownTrack' ? 'music' : 'reference';
    const every = framesOf(5, plan);
    for (let start = skip; start + second <= plan.durationFrames; start += every)
      windows.push({ sourceId: kind, kind, startFrame: start, frames: second });
  }
  if (windows.length <= MAX_AUDIO_WINDOWS) return windows;
  // Keep an even spread across the render rather than the first twelve.
  const step = windows.length / MAX_AUDIO_WINDOWS;
  return Array.from({ length: MAX_AUDIO_WINDOWS }, (_, index) => windows[Math.floor(index * step)]!);
}

function cueProbes(plan: RenderPlan): QaPlan['cues'] {
  const captions = plan.captions;
  if (!captions) return [];
  const pop = captions.style.highlight === 'pop';
  return captions.cues.map((cue) => {
    const start = RationalTime.toFrames(cue.range.start, plan.rate);
    const end = start + RationalTime.toFrames(cue.range.duration, plan.rate);
    const probes = new Set([Math.floor((start + end) / 2)]);
    // Every word's pop at its peak, as the animation plays it (compile/animations.ts).
    if (pop)
      for (const window of popWindows(wordSpans(cue.words, plan.rate))) if (window) probes.add(window.peak);
    return { id: cue.id, span: { start, end }, probeFrames: [...probes].sort((a, b) => a - b) };
  });
}

export function planQa(plan: RenderPlan, preset: ExportPreset): QaPlan {
  const transitionAt = new Map(plan.transitions.map((transition) => [transition.to, transition]));
  const cuts: QaPlan['cuts'][number][] = [];
  plan.visuals.forEach((visual, index) => {
    const previous = plan.visuals[index - 1];
    if (!previous || transitionAt.has(visual.id) || previous.cut.end !== visual.cut.start) return;
    cuts.push({ frame: visual.cut.start, from: previous.id, to: visual.id, beat: visual.beat });
  });
  const anchors = plan.visuals.flatMap((visual) =>
    visual.beat ? [{ clipId: visual.id, frame: visual.cut.start, beatFrame: visual.beat.frame }] : [],
  );
  const dips = plan.transitions.filter((transition) => DIP_EFFECTS.has(transition.effect)).map((t) => t.span);
  const stills = plan.visuals.filter((visual) => visual.kind === 'image').map((visual) => visual.visible);
  const holds = plan.visuals
    .filter(
      (visual) =>
        visual.holdFrame ||
        (visual.speed?.curve === 'hold' && visual.speed.points.some((point) => point.speed <= 0.1)),
    )
    .map((visual) => visual.cut);
  const darkOverlays = plan.visuals.filter(isDarkVisual).map((visual) => visual.visible);
  const fullCompositions = (plan.compositions ?? []).map((placed) => placed.span);
  const programs = (plan.programs ?? []).map((program) => program.span);
  const audio = audioWindows(plan);
  return {
    version: 1,
    rateNum: plan.rate.num,
    rateDen: plan.rate.den,
    durationFrames: plan.durationFrames,
    width: preset.width,
    height: preset.height,
    cuts,
    anchors,
    intendedDark: merge([...plan.gaps, ...dips, ...stills, ...darkOverlays, ...fullCompositions, ...programs]),
    intendedStatic: merge([
      ...plan.gaps,
      ...stills,
      ...holds,
      ...darkOverlays,
      ...fullCompositions,
      ...programs,
    ]),
    clips: plan.visuals.map((visual) => ({ id: visual.id, span: visual.cut, fit: visual.fit })),
    cues: cueProbes(plan),
    texts: plan.texts.map((text) => ({
      id: text.id,
      span: text.span,
      probeFrame: Math.floor((text.span.start + text.span.end) / 2),
      ...(text.refitted ? {} : { box: text.box, align: text.align }),
    })),
    ...(plan.compositions?.length || plan.programs?.length
      ? {
          graphics: [
            ...(plan.compositions ?? []).map((placed) => ({
              id: placed.itemId,
              span: placed.span,
              compositionId: placed.composition.id,
              hash: placed.composition.hash,
              params: placed.values,
            })),
            ...authoredQaGraphics(plan),
          ],
        }
      : {}),
    audio: {
      silent: (plan.music.path === 'platformSound' || plan.music.path === 'none') && plan.audio.length === 0,
      music: plan.music.path,
      referenceAudio: plan.music.path === 'referenceAudio',
      windows: audio,
    },
  };
}
