// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * compileComposition: a timeline revision → one standalone HyperFrames
 * composition (SPEC section 3, P3.1). Pure: the same timeline, preset, fonts,
 * framing, Style and package version give the same bytes and compositionHash.
 * The plan is laid out on the preset's canvas, caption cues are measured,
 * then each layer (compile/layers) draws its part; this file only joins them.
 * Media and fonts are links (hard-linked into the bundle folder when
 * written), hashed by the content key the caller gives, so compiling never
 * reads a file.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  err,
  ok,
  RationalTime,
  type CaptionStyle,
  type CaptionTrack,
  type FrameRate,
  type Rect,
  type Result,
  type Timeline,
} from '@taalcut/core';
import { UnsupportedFrameRate } from '../errors';
import { planForPreset } from '../plan/canvas';
import { planQa } from '../plan/qa-plan';
import type { RenderPlan } from '../plan/types';
import { durationSeconds, isSupportedRate, rateLabel } from '../time/frames';
import type { CaptionFontId, CueLayout, QaPlan } from '../types';
import { baseCss, familyList, fontFaces, TEXT_FONT } from './css';
import { element, jsonForScript } from './html';
import type { CaptionBox, LayerContext, LayerLink, LayerOutput } from './layer';
import type { CaptionLayout, CompileOptions } from './compile-options';
import { compositionLayers } from './layers';
import { COMPOSITION_ID, TC_RUNTIME_JS, TC_RUNTIME_VERSION } from './runtime';
import { gsapBundlePath, gsapDistDir, gsapFilesFor, GSAP_LOCK } from '../motion/gsap-files';
import { joinMotion } from '../motion/motion-data';

export type { CompositionMediaEntry } from './layers/visuals';

export type { CaptionLayout, CompileOptions } from './compile-options';

export type BundleLink = LayerLink;

export interface CompositionBundle {
  /** Text files by bundle path. */
  readonly files: Readonly<Record<string, string>>;
  /** Files hard-linked (or copied) into the bundle, by bundle path. */
  readonly links: Readonly<Record<string, BundleLink>>;
  readonly compositionHash: string;
  readonly qaPlan: QaPlan;
  readonly plan: RenderPlan;
  readonly durationFrames: number;
  readonly rate: FrameRate;
  /** Cue boxes as laid out (QA's captionCoversFace, graphics layout). */
  readonly captionBoxes: readonly CaptionBox[];
  readonly warnings: readonly string[];
}

export { COMPOSITION_ID };

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** The estimate used without a measurer: one line at 1.2 line height, centred on anchorY, inside `safe`. */
export function estimateCueLayout(
  words: readonly string[],
  style: CaptionStyle,
  safe: Rect,
  canvasHeight = 1920,
): CueLayout {
  const heightPx = Math.round(style.sizePx * 1.2);
  const centre = style.anchorY * canvasHeight;
  const top = Math.min(Math.max(centre - heightPx / 2, safe.y), safe.y + safe.height - heightPx);
  return {
    lines: [words.join(' ')],
    lineWords: [words.length],
    widthPx: safe.width,
    heightPx,
    topPx: Math.round(top),
  };
}

const cueWords = (track: CaptionTrack, index: number) =>
  (track.cues[index]?.words ?? []).map((word) => word.text);

/** Every cue laid out on the plan's canvas (with any dodged anchors) and its box; reframing reads the boxes. */
export function layCaptions(
  captions: CaptionTrack | null,
  plan: RenderPlan,
  options: Pick<CompileOptions, 'preset' | 'captionLayout' | 'captionAnchors'>,
): { layouts: { id: string; layout: CueLayout }[]; boxes: CaptionBox[] } {
  if (!captions) return { layouts: [], boxes: [] };
  const safe = options.preset.safe;
  const layoutOf: CaptionLayout =
    options.captionLayout ??
    ((words, style, rect, _language, canvasHeight) => estimateCueLayout(words, style, rect, canvasHeight));
  const layouts = captions.cues.map((cue, index) => {
    const anchorY = options.captionAnchors?.get(cue.id);
    const style = anchorY === undefined ? captions.style : { ...captions.style, anchorY };
    const layout = layoutOf(cueWords(captions, index), style, safe, captions.language, plan.height);
    return { id: cue.id, layout };
  });
  const boxes = captions.cues.flatMap((cue, index) => {
    const layout = layouts[index]?.layout;
    if (!layout) return [];
    const start = RationalTime.toFrames(cue.range.start, plan.rate);
    return {
      id: cue.id,
      span: { start, end: start + RationalTime.toFrames(cue.range.duration, plan.rate) },
      box: {
        x: Math.round(safe.x + (safe.width - layout.widthPx) / 2),
        y: layout.topPx,
        width: layout.widthPx,
        height: layout.heightPx,
      },
    };
  });
  return { layouts, boxes };
}

function joined(outputs: readonly LayerOutput[]) {
  return {
    markup: outputs.flatMap((output) => output.markup),
    css: outputs.flatMap((output) => output.css),
    motion: joinMotion(outputs.map((output) => output.motion)),
    links: Object.assign({}, ...outputs.map((output) => output.links)) as Record<string, LayerLink>,
    fonts: outputs.flatMap((output) => output.fonts),
    warnings: outputs.flatMap((output) => output.warnings),
  };
}

export function compileComposition(timeline: Timeline, options: CompileOptions): Result<CompositionBundle> {
  const rate = timeline.canvas.rate;
  if (!isSupportedRate(rate)) return err(UnsupportedFrameRate({ rate: rateLabel(rate) }));
  const planned = planForPreset(timeline, options.preset);
  if (!planned.ok) return planned;
  const plan = options.bumpers ? { ...planned.value, bumpers: options.bumpers } : planned.value;
  const captions = options.burnCaptions ? plan.captions : null;
  const { layouts, boxes } = layCaptions(captions, plan, options);
  const context: LayerContext = {
    plan,
    variant: options.variant,
    preset: options.preset,
    width: options.preset.width,
    height: options.preset.height,
    safe: options.preset.safe,
    rate,
    captions,
    captionBoxes: boxes,
    style: options.style ?? null,
    ...(options.fonts ? { fonts: options.fonts } : {}),
    ...(options.keepOut ? { keepOut: options.keepOut } : {}),
  };
  const outputs: LayerOutput[] = [];
  for (const layer of compositionLayers(options, layouts)) {
    const built = layer.build(context);
    if (!built.ok) return built;
    outputs.push(built.value);
  }
  const layers = joined(outputs);
  const fontIds = [
    ...new Set<CaptionFontId>([TEXT_FONT, ...(captions ? [captions.style.font] : []), ...layers.fonts]),
  ];
  const faces = options.fonts ? options.fonts.faces(fontIds) : [];
  const links: Record<string, LayerLink> = { ...layers.links };
  for (const face of faces)
    if (options.fonts)
      links[`fonts/${face.file}`] = { source: join(options.fonts.dir, face.file), key: face.sha256 };
  if (options.variant === 'preview' && options.runtimeScript)
    links['_hf/runtime.js'] = { source: options.runtimeScript.file, key: options.runtimeScript.key };
  // GSAP and the plugins this motion uses, from the installed package (SPEC G.1): never fetched.
  const gsapFiles = gsapFilesFor(layers.motion);
  const gsapDir = gsapDistDir();
  for (const file of gsapFiles)
    links[gsapBundlePath(file)] = { source: join(gsapDir, file), key: GSAP_LOCK[file].sha256 };
  const textFamilies = familyList(options.fonts ? options.fonts.stack(TEXT_FONT) : []);
  const css = [
    ...fontFaces(faces),
    ...baseCss({ width: context.width, height: context.height, textFamilies }),
    ...layers.css,
  ].join('\n');
  const duration = durationSeconds(plan.durationFrames, rate);
  const data = { version: TC_RUNTIME_VERSION, duration: Number(duration), motion: layers.motion };
  const fps = (rate.num / rate.den).toFixed(3).replace(/\.?0+$/, '');
  const root = element(
    'div',
    {
      id: 'root',
      'data-composition-id': COMPOSITION_ID,
      'data-start': '0',
      'data-width': String(context.width),
      'data-height': String(context.height),
      'data-fps': fps,
      'data-duration': duration,
    },
    `\n${layers.markup.join('\n')}\n`,
  );
  const head = [
    '<meta charset="utf-8">',
    element('link', { rel: 'stylesheet', href: 'tc.css' }, '', true),
    ...(options.variant === 'preview' && options.runtimeScript
      ? [element('script', { src: '_hf/runtime.js' })]
      : []),
  ].join('\n');
  const html = [
    '<!doctype html>',
    element(
      'html',
      { lang: captions?.language ?? 'en' },
      `\n<head>\n${head}\n</head>\n<body>\n${root}\n` +
        `${element('script', { type: 'application/json', id: 'tc-data' }, jsonForScript(data))}\n` +
        gsapFiles.map((file) => `${element('script', { src: gsapBundlePath(file) })}\n`).join('') +
        `${element('script', { src: 'tc.js' })}\n` +
        '</body>\n',
    ),
    '',
  ].join('\n');
  const files: Record<string, string> = {
    'index.html': html,
    'tc.css': css,
    'tc.js': TC_RUNTIME_JS,
  };
  const entries = [
    ...Object.entries(files).map(([path, content]) => `${path}\0${sha256(content)}`),
    ...Object.entries(links).map(([path, link]) => `${path}\0${link.key}`),
  ].sort();
  return ok({
    files,
    links,
    compositionHash: sha256(entries.join('\n')),
    qaPlan: planQa(plan, options.preset),
    plan,
    durationFrames: plan.durationFrames,
    rate,
    captionBoxes: boxes,
    warnings: layers.warnings,
  });
}
