// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The visuals layer: one <video> or <img> per enabled clip in timeline order, its fit, its transitions, a
 * still's gentle motion (P3-B7) and a reframe's crop or blurred pad (P3-V2). Export segments are already
 * conformed (fit baked in, or scaled for the crop); preview proxies fit here.
 */
import { err, ok, type RationalTime } from '@taalcut/core';
import { MediaMissing } from '../../errors';
import type { FramingPlan, VisualFraming } from '../../reframe/framing-types';
import { stillMotionTracks } from '../../stills/still-motion';
import type { FrameSpan, PlannedVisual } from '../../plan/types';
import { mediaStartSeconds, windowSeconds } from '../../time/frames';
import { elementId, visualAnimations, type ExtraTrack } from '../animations';
import { element } from '../html';
import { gradeFilters, gradeWrapper } from './grade-filters';
import { visualRegions } from './visual-regions';
import { layerOutput, type CompositionLayer, type LayerContext, type LayerLink } from '../layer';
import type { MotionTween } from '../../motion/motion-data';
import type { AnimatedProperty } from '../tracks';

/** What a visual plays: a file (conformed segment or proxy) and the time inside it at `visible.start`. */
export interface CompositionMediaEntry {
  readonly file: string;
  /** Content key (hash) of the file; part of the composition hash. */
  readonly key: string;
  readonly mediaStart: RationalTime;
  /** 'mp4', 'jpg', 'png'. */
  readonly ext: string;
  /** Preview only: the clip's mean speed (ramps are exact only in exports, which bake them). */
  readonly playbackRate?: number;
}

/** A crop framing drawn as CSS: rules for the element and the tracks it animates (reframe/keyframes.ts). */
export type CropStyle = (
  visual: PlannedVisual,
  framing: Extract<VisualFraming, { kind: 'crop' }>,
  context: LayerContext,
) => { readonly css: readonly string[]; readonly tracks: readonly ExtraTrack[] };

export interface VisualsLayerOptions {
  readonly media: (visual: PlannedVisual) => CompositionMediaEntry | undefined;
  readonly framing?: FramingPlan;
  readonly cropStyle?: CropStyle;
}

/** The blurred pad's background: Chrome's compositor blurs on the GPU. */
const PAD_FILTER = 'blur(48px) brightness(0.6)';

const isStill = (visual: PlannedVisual, entry: CompositionMediaEntry) =>
  visual.kind === 'image' || entry.ext === 'jpg' || entry.ext === 'png';

function mediaElement(
  id: string,
  visual: PlannedVisual,
  entry: CompositionMediaEntry,
  path: string,
  context: LayerContext,
  probeId: string | undefined,
): string {
  const window = windowSeconds(visual.visible.start, visual.visible.end, context.rate);
  if (isStill(visual, entry))
    return element(
      'img',
      {
        id,
        class: 'clip tc-i',
        src: path,
        alt: '',
        'data-start': window.start,
        'data-duration': window.duration,
        'data-tc-visual': probeId,
      },
      '',
      true,
    );
  return element('video', {
    id,
    class: 'tc-v',
    src: path,
    muted: true,
    playsinline: true,
    preload: 'auto',
    'data-start': window.start,
    'data-duration': window.duration,
    'data-media-start': mediaStartSeconds(entry.mediaStart, context.rate),
    'data-playback-rate':
      context.variant === 'preview' && entry.playbackRate && entry.playbackRate !== 1
        ? String(entry.playbackRate)
        : undefined,
    'data-tc-visual': probeId,
  });
}

/** The longest part of `span` that no busy span overlaps (a still's motion stays clear of transitions). */
export function clearOf(span: FrameSpan, busy: readonly FrameSpan[]): FrameSpan {
  const cuts = busy.filter((b) => b.start < span.end && span.start < b.end).sort((a, b) => a.start - b.start);
  let best: FrameSpan = { start: span.start, end: span.start };
  let from = span.start;
  for (const cut of [...cuts, { start: span.end, end: span.end }]) {
    const piece = { start: from, end: Math.min(cut.start, span.end) };
    if (piece.end - piece.start > best.end - best.start) best = piece;
    from = Math.max(from, cut.end);
  }
  return best;
}

export function visualsLayer(options: VisualsLayerOptions): CompositionLayer {
  return {
    id: 'visuals',
    build(context) {
      const { plan, variant } = context;
      const markup: string[] = [];
      const css: string[] = [];
      const links: Record<string, LayerLink> = {};
      const crops = new Map<string, readonly ExtraTrack[]>();
      const pads: string[] = [];
      const regionTweens: MotionTween[] = [];
      const enabled = plan.visuals.filter((visual) => visual.enabled);
      // EDT1-OPS: graded visuals are drawn through their grade's filter (grade-filters.ts).
      const grades = gradeFilters(enabled);
      if (grades.markup) markup.push(grades.markup);
      if (grades.markup)
        css.push('.tc-grades { position: absolute; width: 0; height: 0; overflow: hidden; }');
      for (const [index, visual] of enabled.entries()) {
        const entry = options.media(visual);
        if (!entry) return err(MediaMissing({ name: visual.id }));
        const path = `media/${visual.id}.${entry.ext}`;
        links[path] = { source: entry.file, key: entry.key };
        const id = elementId.visual(visual);
        const framing = options.framing?.visuals.get(visual.id) ?? { kind: 'fit' };
        const z = index + 1;
        const own: string[] = [];
        if (visual.visualLayout) {
          const source = options.framing?.sourceSizes?.get(visual.id);
          if (!source) return err(MediaMissing({ name: `${visual.id}: layout source size` }));
          const regions = visualRegions(visual, source, context, (regionId) =>
            mediaElement(
              regionId,
              visual,
              entry,
              path,
              context,
              `${visual.id}:region:${regionId.split('-r').at(-1)}`,
            ),
          );
          const filter = grades.filterOf(visual);
          if (filter) {
            const wrapper = gradeWrapper(visual.id, filter, z, plan);
            markup.push(wrapper.open, regions.markup, wrapper.close);
            css.push(wrapper.css);
          } else markup.push(regions.markup);
          css.push(
            `#${id} { z-index: ${z}; position: absolute; inset: 0; width: 100%; height: 100%; }`,
            ...regions.css,
          );
          regionTweens.push(...regions.tweens);
          continue;
        }
        if (framing.kind === 'blurPad') {
          const pad = elementId.pad(visual);
          pads.push(visual.id);
          own.push(mediaElement(pad, visual, entry, path, context, undefined));
          css.push(`#${pad} { z-index: ${z}; object-fit: cover; filter: ${PAD_FILTER}; }`);
        }
        own.push(mediaElement(id, visual, entry, path, context, visual.id));
        const filter = grades.filterOf(visual);
        if (filter) {
          const wrapper = gradeWrapper(visual.id, filter, z, plan);
          markup.push(wrapper.open, ...own, wrapper.close);
          css.push(wrapper.css);
        } else markup.push(...own);
        if (framing.kind === 'crop' && options.cropStyle) {
          const style = options.cropStyle(visual, framing, context);
          crops.set(visual.id, style.tracks);
          css.push(`#${id} { z-index: ${z}; object-fit: cover; }`, ...style.css);
          continue;
        }
        // Export segments are already conformed to the canvas with their fit; preview proxies fit here.
        if (
          framing.kind === 'fit' &&
          visual.fit === 'contain' &&
          variant === 'preview' &&
          context.width < context.height
        ) {
          const left = (context.width - context.height) / 2;
          const top = (context.height - context.width) / 2;
          css.push(
            `#${id} { z-index: ${z}; left: ${left}px; top: ${top}px; width: ${context.height}px; height: ${context.width}px; transform: rotate(90deg); object-fit: cover; }`,
          );
          continue;
        }
        const fit = framing.kind === 'blurPad' ? 'contain' : variant === 'export' ? 'fill' : visual.fit;
        css.push(`#${id} { z-index: ${z}; object-fit: ${fit}; }`);
      }
      const animations = visualAnimations(plan, (visual, busy) => [
        ...stillMotionFor(visual, busy, context),
        ...(crops.get(visual.id) ?? []),
      ]);
      const padAnimations = padCopies(animations, plan.visuals, pads);
      return ok(
        layerOutput({
          markup,
          css,
          links,
          motion: { tweens: [...animations, ...padAnimations, ...regionTweens], splits: [] },
        }),
      );
    },
  };
}

function stillMotionFor(
  visual: PlannedVisual,
  busy: ReadonlyMap<AnimatedProperty, readonly FrameSpan[]>,
  context: LayerContext,
): ExtraTrack[] {
  if (visual.kind !== 'image') return [];
  const occupied = [
    ...(busy.get('scale') ?? []),
    ...(busy.get('xPercent') ?? []),
    ...(busy.get('yPercent') ?? []),
  ];
  return stillMotionTracks(visual.stillMotion, clearOf(visual.visible, occupied), context.rate);
}

/** A blurred pad moves with its visual through every transition (opacity, slides, zooms). */
function padCopies(
  animations: readonly MotionTween[],
  visuals: readonly PlannedVisual[],
  pads: readonly string[],
): MotionTween[] {
  const copies: MotionTween[] = [];
  for (const id of pads) {
    const visual = visuals.find((candidate) => candidate.id === id);
    if (!visual) continue;
    const target = elementId.visual(visual);
    for (const animation of animations) {
      const { targets } = animation;
      if ('ids' in targets && targets.ids.length === 1 && targets.ids[0] === target)
        copies.push({ ...animation, targets: { ids: [elementId.pad(visual)] } });
    }
  }
  return copies;
}
