// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Reframing (P3-V2, SPEC P3.2): for every video clip with a reframe setting, or every clip when the preset's
 * canvas differs from the timeline's, the subject track (the media cache's, else tracked now: the export does,
 * a preview only reads stored tracks), its framing, the conform geometry that keeps only the path's extent (the
 * export's segments; a preview plays the whole source), the CSS that pans the crop, and new anchors for the
 * captions a face would sit under. No track (no helper, a failed tracking): a centre crop and a warning, never a
 * failed export. Preview framing is export framing: both run this.
 */
import {
  type FrameRate,
  ok,
  RationalTime,
  type AsyncResult,
  type CaptionTrack,
  type Rect,
  type SubjectTrack,
  type TimeRange,
} from '@taalcut/core';
import { probeMedia, type MediaContext } from '@taalcut/media';
import { elementId } from '../../compile/animations';
import { layCaptions, type CompileOptions } from '../../compile/composition';
import type { CropStyle } from '../../compile/layers/visuals';
import { sameCanvas } from '../../plan/canvas';
import type { FrameSpan, PlannedVisual } from '../../plan/types';
import { layoutHeadsAt, type LayoutClip } from '../../qa/checks/visual-layout';
import { facesOnCanvasAt, type ReframedClip } from '../../qa/checks/reframe';
import type { QaFacts } from '../../qa/modules';
import { dodgeCaptions } from '../../reframe/caption-dodge';
import { planVisualFraming } from '../../reframe/framing';
import type { SourceRect, VisualFraming } from '../../reframe/framing-types';
import { blurPadGeometry, framingGeometry, framingTracks } from '../../reframe/keyframes';
import { exportJobOf, type ExportJobRef, type SubjectTrackSource } from '../../ports-phase3';
import type { ExportInputs } from '../export-inputs';
import type { SegmentGeometry } from '../segment-args';
import type { StageContext } from './context';

/** What reframing reads of an export (or of a preview, whose sources are proxies). */
export type FramingInputs = Pick<ExportInputs, 'plan' | 'timeline' | 'preset' | 'captionLayout'> & {
  readonly sources: ReadonlyMap<string, { readonly path: string }>;
};

export interface FramingContext {
  readonly subjectTracks?: SubjectTrackSource;
  readonly media: MediaContext;
  readonly burnCaptions: boolean;
  readonly signal?: AbortSignal;
  /** Track a shot that has no stored track (the export); a preview reads stored tracks only. */
  readonly trackMissing: boolean;
  /** Conform segments to the path's extent (the export); a preview's proxy shows the whole frame. */
  readonly conform: boolean;
  /** Before the first shot is tracked (the export's `reframing` stage). */
  readonly onTracking?: () => void;
  /** The export's job, the parent of the tracking jobs it waits on. */
  readonly job?: ExportJobRef;
}

export interface PlannedFraming {
  readonly compose: Pick<CompileOptions, 'framing' | 'cropStyle' | 'captionAnchors'>;
  /** The conform geometry of a reframed visual; undefined keeps the Phase 2 fit. */
  readonly geometry: (visual: PlannedVisual) => SegmentGeometry | undefined;
  readonly qa: NonNullable<QaFacts['reframe']>;
  readonly warnings: readonly string[];
}

interface Size {
  readonly width: number;
  readonly height: number;
}

const WHOLE: SourceRect = { x: 0, y: 0, width: 1, height: 1 };
/** Faces are sampled this often across a cue to decide whether it moves. */
const DODGE_STEP_FRAMES = 6;

const canvasChanged = (inputs: FramingInputs) => !sameCanvas(inputs.timeline.canvas, inputs.preset);

/** The clips this export reframes: video with a reframe setting, or every video clip on another canvas. */
export function framedVisuals(inputs: FramingInputs): PlannedVisual[] {
  const changed = canvasChanged(inputs);
  return inputs.plan.visuals.filter(
    (visual) =>
      visual.enabled &&
      visual.kind === 'video' &&
      (visual.visualLayout !== undefined || visual.reframe !== null || changed),
  );
}

/** The source range a visual shows (its visible window at its mean speed), for the subject track. */
function shownRange(visual: PlannedVisual, rate: FrameRate): TimeRange {
  const seconds = ((visual.visible.end - visual.visible.start) * rate.den * visual.meanSpeed) / rate.num;
  return {
    start: visual.sourceIn,
    duration: RationalTime.fromSeconds(seconds, visual.sourceIn.rate),
  };
}

async function trackFor(context: FramingContext, visual: PlannedVisual, rate: FrameRate) {
  const source = context.subjectTracks;
  if (!source || visual.reframe?.mode === 'centre' || visual.reframe?.mode === 'blurPad') return ok(null);
  const range = shownRange(visual, rate);
  const stored = await source.get(visual.assetId, range, context.signal);
  if (!stored.ok || stored.value || !context.trackMissing) return stored;
  context.onTracking?.();
  return source.track(visual.assetId, range, context.signal, context.job);
}

/** The top of the burnt-in caption band at the style's anchor, or null without captions. */
function captionBandTop(inputs: FramingInputs, captions: CaptionTrack | null): number | null {
  const { boxes } = layCaptions(captions, inputs.plan, inputs);
  return boxes.length === 0 ? null : Math.min(...boxes.map((box) => box.box.y));
}

/** Cue anchors moved off the faces the crops put under them. */
function captionAnchors(
  inputs: FramingInputs,
  captions: CaptionTrack | null,
  clips: readonly ReframedClip[],
  layouts: readonly LayoutClip[],
): Map<string, number> {
  const anchors = new Map<string, number>();
  if (!captions || (layouts.length === 0 && clips.every((clip) => clip.framing.kind !== 'crop')))
    return anchors;
  const canvas = { width: inputs.plan.width, height: inputs.plan.height };
  const { boxes } = layCaptions(captions, inputs.plan, inputs);
  const facesDuring = (span: FrameSpan): Rect[] => {
    const faces: Rect[] = [];
    for (let frame = span.start; frame < span.end; frame += DODGE_STEP_FRAMES)
      faces.push(
        ...facesOnCanvasAt(clips, frame, canvas),
        ...layoutHeadsAt(layouts, frame, canvas, inputs.plan.rate),
      );
    return faces;
  };
  const moved = dodgeCaptions(boxes, facesDuring, inputs.preset.safe);
  for (const box of boxes) {
    const top = moved.get(box.id)?.topPx;
    if (top !== undefined) anchors.set(box.id, (top + box.box.height / 2) / inputs.plan.height);
  }
  return anchors;
}

interface Framed {
  readonly framing: Exclude<VisualFraming, { kind: 'fit' }>;
  readonly geometry: SegmentGeometry;
  readonly clip: ReframedClip;
}

/** One visual's framing, its conform geometry and its QA record; null when it keeps its fit. */
function frameVisual(
  context: FramingContext,
  inputs: FramingInputs,
  visual: PlannedVisual,
  source: Size,
  track: SubjectTrack | null,
  bandTop: number | null,
): Framed | null {
  const canvas: Size = { width: inputs.plan.width, height: inputs.plan.height };
  const framing = planVisualFraming({
    visual,
    source,
    canvas,
    safe: inputs.preset.safe,
    captionBandTop: bandTop,
    track,
    rate: inputs.plan.rate,
    canvasChanged: canvasChanged(inputs),
  });
  if (framing.kind === 'fit') return null;
  const cropped = framing.kind === 'crop' ? framingGeometry(framing, source, canvas) : null;
  const geometry: SegmentGeometry = cropped
    ? { scaled: cropped.scaledSize, crop: cropped.crop }
    : { scaled: blurPadGeometry(source, canvas), crop: null };
  const extent = cropped && context.conform ? cropped.extent : WHOLE;
  const clip = {
    clipId: visual.id,
    visible: visual.visible,
    framing,
    reframe: visual.reframe,
    source,
    extent,
  };
  return { framing, geometry, clip };
}

const PROBE_CONCURRENCY = 4;

/** Each source's upright display size, probed once with bounded concurrency. */
async function displaySizes(
  context: FramingContext,
  inputs: FramingInputs,
  visuals: readonly PlannedVisual[],
) {
  const sizes = new Map<string, Size | null>();
  const paths = [
    ...new Set(
      visuals.flatMap((visual) => {
        const path = inputs.sources.get(visual.id)?.path;
        return path ? [path] : [];
      }),
    ),
  ];
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const path = paths[next++]!;
      const probe = await probeMedia(path, context.media);
      const video = probe.ok ? probe.value.video : undefined;
      sizes.set(path, video ? { width: video.displayWidth, height: video.displayHeight } : null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, paths.length) }, worker));
  return (visual: PlannedVisual) => {
    const path = inputs.sources.get(visual.id)?.path;
    return path ? (sizes.get(path) ?? null) : null;
  };
}

/** The crop's tc.css rule and frame tracks, over the extent the visual's media shows. */
const cropStyleOf =
  (clips: ReadonlyMap<string, ReframedClip>): CropStyle =>
  (visual, framing, context) => {
    const placed = clips.get(visual.id);
    return framingTracks({
      elementId: elementId.visual(visual),
      framing,
      extent: placed?.extent ?? WHOLE,
      canvas: { width: context.width, height: context.height },
      sourceAspect: placed ? placed.source.width / placed.source.height : context.width / context.height,
      visible: visual.visible,
      rate: context.rate,
    });
  };

/** Reframing for any context: the export's stage below, or a preview (stored tracks, whole-frame proxies). */
export async function planFramingWith(
  context: FramingContext,
  inputs: FramingInputs,
): AsyncResult<PlannedFraming | null> {
  const visuals = framedVisuals(inputs);
  if (visuals.length === 0) return ok(null);
  const captions = context.burnCaptions ? inputs.plan.captions : null;
  const bandTop = captionBandTop(inputs, captions);
  const sizeOf = await displaySizes(context, inputs, visuals);
  const framings = new Map<string, VisualFraming>();
  const geometries = new Map<string, SegmentGeometry>();
  const clips = new Map<string, ReframedClip>();
  const warnings: string[] = [];
  const sourceSizes = new Map<string, Size>();
  const layouts: LayoutClip[] = [];
  for (const visual of visuals) {
    const source = sizeOf(visual);
    if (!source) continue;
    if (visual.visualLayout) {
      // Keep the whole source for both viewports; a single centre crop would permanently discard one of them.
      sourceSizes.set(visual.id, source);
      const tracked = await trackFor(context, visual, inputs.plan.rate);
      layouts.push({ visual, source, track: tracked.ok ? tracked.value : null });
      geometries.set(visual.id, {
        scaled: { width: Math.ceil(source.width / 2) * 2, height: Math.ceil(source.height / 2) * 2 },
        crop: null,
      });
      continue;
    }
    const tracked = await trackFor(context, visual, inputs.plan.rate);
    if (!tracked.ok) warnings.push(`reframe ${visual.id}: tracking failed (${tracked.error.code}), centred`);
    const framed = frameVisual(context, inputs, visual, source, tracked.ok ? tracked.value : null, bandTop);
    if (!framed) continue;
    if (framed.framing.kind === 'crop' && framed.framing.reason === 'noTrack')
      warnings.push(`reframe ${visual.id}: no subject track, centred crop`);
    framings.set(visual.id, framed.framing);
    geometries.set(visual.id, framed.geometry);
    clips.set(visual.id, framed.clip);
  }
  const reframed = [...clips.values()];
  return ok({
    compose: {
      framing: { visuals: framings, warnings, sourceSizes },
      cropStyle: cropStyleOf(clips),
      captionAnchors: captionAnchors(inputs, captions, reframed, layouts),
    },
    geometry: (visual) => (context.conform ? geometries.get(visual.id) : undefined),
    qa: {
      clips: reframed,
      layouts,
      transitions: inputs.plan.transitions.map((transition) => transition.span),
    },
    warnings,
  });
}

/** The export's reframing stage: tracks what is missing, conforms to the path's extent. */
export function planFraming(stage: StageContext, inputs: ExportInputs): AsyncResult<PlannedFraming | null> {
  return planFramingWith(
    {
      ...(stage.deps.subjectTracks ? { subjectTracks: stage.deps.subjectTracks } : {}),
      media: stage.deps.media,
      burnCaptions: stage.record.captions.burnIn,
      signal: stage.signal,
      trackMissing: true,
      conform: true,
      onTracking: () => stage.tracker.stage('reframing'),
      job: exportJobOf(stage.record),
    },
    inputs,
  );
}
