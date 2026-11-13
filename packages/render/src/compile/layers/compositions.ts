// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Workspace compositions folded into the timeline's composition (HFW1 "hf: compile"): each placed composition
 * becomes one clip (`#w-<item id>`, its window the item's) holding the composition's root, its ids prefixed so
 * they can't meet another's, its words filled from its variables (`data-var-text`) and escaped, and its colour and
 * number variables set as custom properties on the clip, as HyperFrames sets them on a sub-composition's host. Its
 * rules go into tc.css scoped under the clip, its fonts become the bundled stacks, and its lowered tweens join the
 * one master timeline tc.js builds, moved to the item's start (and, from the `exit` label on, to the item's end).
 * Preview and export run this same layer. No script of the composition's reaches the page.
 */
import { ok, type GraphicParam } from '@taalcut/core';
import { serialize, type MarkupNode } from '../../workspace/html/markup';
import {
  frameSeconds,
  jumpSeconds,
  type MotionTargets,
  type MotionTween,
  type SplitSpec,
} from '../../motion/motion-data';
import { windowSeconds } from '../../time/frames';
import type { CaptionFontId, CompositionFonts } from '../../types';
import { curatedFont, familyNames } from '../../workspace/gate/css-rules';
import type { PreparedComposition } from '../../workspace/gate/prepare';
import { fontStack } from '../../captions/fonts';
import { cssString, element, escapeHtml } from '../html';
import { layerOutput, Z, type CompositionLayer, type LayerContext, type LayerLink } from '../layer';
import { placementsOf } from '../../workspace/fold/placements';
import type { AssetLink, CompositionPlacement, WorkspaceReader } from '../../workspace/fold/types';
import { TEXT_FONT } from '../css';

export type { AssetLink, CompositionPlacement };

const URL_CALL = /url\(\s*(['"]?)([^'"()\s]*)\1\s*\)/gi;

/** A style value with each asset `url()` pointing at the asset's place in the bundle. */
const withAssetUrls = (value: string, assets: Readonly<Record<string, AssetLink>>) =>
  value.replace(URL_CALL, (call, _quote, path: string) =>
    assets[path] ? `url(${cssString(assets[path].bundlePath)})` : call,
  );

export const compositionElementId = (itemId: string) => `w-${itemId}`;

type Value = string | number | boolean;

/** Each variable's value: the item's when it fits the variable, else the default (with a warning). */
function valuesOf(
  params: readonly GraphicParam[],
  given: Readonly<Record<string, Value>>,
  warn: (note: string) => void,
) {
  const values = new Map<string, Value>();
  for (const param of params) {
    const value = given[param.name];
    const fits =
      value !== undefined &&
      (param.type === 'text'
        ? typeof value === 'string' && value.length <= param.maxLength
        : param.type === 'colour'
          ? typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
          : param.type === 'number'
            ? typeof value === 'number' && Number.isFinite(value)
            : param.type === 'boolean'
              ? typeof value === 'boolean'
              : typeof value === 'string' && param.options.includes(value));
    if (value !== undefined && !fits) warn(`variable ${param.name} has a value that does not fit it`);
    values.set(param.name, fits ? value : param.type === 'text' ? param.sample : param.default);
  }
  return values;
}

const familyListOf = (stack: readonly string[]) => [...stack.map(cssString), 'sans-serif'].join(', ');

/** A font-family value as the bundled stack of the first bundled font it names (no system font is reached). */
function fontFamily(value: string, fonts: CompositionFonts | undefined): string {
  const found = curatedFont(value);
  if (!('font' in found)) return familyListOf(familyNames(value) ?? []);
  const font = found.font as CaptionFontId;
  return familyListOf(fonts ? fonts.stack(font) : fontStack(font));
}

/** Selectors with every authored id prefixed, scoped under the clip. */
const scopedSelectors = (selectors: string, scope: string, prefix: string) =>
  selectors
    .split(',')
    .map((selector) => `#${scope} ${selector.trim().replace(/#([A-Za-z_][A-Za-z0-9_-]*)/g, `#${prefix}$1`)}`)
    .join(', ');

function prefixed(targets: MotionTargets, prefix: string): MotionTargets {
  return 'ids' in targets
    ? { ids: targets.ids.map((id) => prefix + id) }
    : { split: targets.split.map((id) => prefix + id), unit: targets.unit };
}

/** The composition's tweens at the item's place on the master timeline. */
function placedTweens(placement: CompositionPlacement, context: LayerContext, prefix: string): MotionTween[] {
  const { composition, span } = placement;
  const start = frameSeconds(span.start, context.rate);
  const length = frameSeconds(span.end - span.start, context.rate);
  const exit = composition.motion.labels.exit;
  const shift = length - composition.doc.durationSeconds;
  return composition.motion.tweens.map((tween) => {
    if (placement.sourceStart !== undefined)
      return {
        ...tween,
        at:
          tween.duration === 0
            ? jumpSeconds(Math.ceil((tween.at * context.rate.num) / context.rate.den - 1e-9), context.rate)
            : tween.at,
        targets: prefixed(tween.targets, prefix),
        clock: { id: placement.itemId, start, duration: length, sourceStart: placement.sourceStart },
      };
    const local = exit !== undefined && tween.at >= exit - 1e-9 ? tween.at + shift : tween.at;
    // A jump lands half a frame before the frame it falls on, so a seek from either side shows it (motion-data.ts).
    const at =
      tween.duration === 0
        ? jumpSeconds(
            span.start + Math.ceil(local * (context.rate.num / context.rate.den) - 1e-9),
            context.rate,
          )
        : start + Math.max(0, local);
    return { ...tween, targets: prefixed(tween.targets, prefix), at };
  });
}

function markupOf(
  placement: CompositionPlacement,
  context: LayerContext,
  prefix: string,
  values: Map<string, Value>,
) {
  const { root } = placement.composition.doc;
  const generated = placement.composition.motion.generatedIds;
  const offset = frameSeconds(placement.span.start, context.rate) - (placement.sourceStart ?? 0);
  const attributes = (node: MarkupNode) => {
    const out: [string, string][] = [];
    const id = node === root ? (node.attributes.id ?? 'root') : (node.attributes.id ?? generated.get(node));
    if (id !== undefined) out.push(['id', prefix + id]);
    for (const [name, value] of Object.entries(node.attributes)) {
      if (name === 'id' || name.startsWith('data-var-') || name.startsWith('data-composition')) continue;
      if (node === root && ['data-width', 'data-height', 'data-duration', 'data-start'].includes(name))
        continue;
      // An inner clip's window is the composition's time; the master's is the timeline's.
      if (name === 'data-start') out.push([name, String(Math.round((Number(value) + offset) * 1e6) / 1e6)]);
      else if (name === 'src' && placement.assets?.[value])
        out.push([name, placement.assets[value].bundlePath]);
      // A paint, clip or mask by id names the composition's own element, prefixed like it.
      else out.push([name, value.replace(/^url\(#([A-Za-z][A-Za-z0-9_-]*)\)$/, `url(#${prefix}$1)`)]);
    }
    return out;
  };
  const content = (node: MarkupNode) => {
    const bound = node.attributes['data-var-text'];
    const value = bound === undefined ? undefined : values.get(bound);
    return value === undefined ? undefined : escapeHtml(String(value));
  };
  return serialize([root], {
    condition: () => true,
    text: () => '',
    attributes,
    content,
    voids: new Set(['img']),
  });
}

/**
 * A composition is authored on its own canvas (1080×1920): on an output of another size its clip is that size,
 * scaled uniformly to fit the output and centred, as the rest of the composition maps (nothing when they match).
 */
function fitted(composition: PreparedComposition, context: LayerContext): string {
  const { width, height } = composition.doc;
  if (width === context.width && height === context.height) return '';
  const scale = Math.min(context.width / width, context.height / height);
  const left = Math.round(((context.width - width * scale) / 2) * 100) / 100;
  const top = Math.round(((context.height - height * scale) / 2) * 100) / 100;
  return ` width: ${width}px; height: ${height}px; transform-origin: 0 0; transform: translate(${left}px, ${top}px) scale(${Math.round(scale * 1e6) / 1e6});`;
}

/**
 * The layer: the placements given (tests, the spike), else the plan's compositions read from the workspace
 * (workspace/fold/placements.ts), in placement order (later ones draw above).
 */
export function compositionsLayer(
  given: readonly CompositionPlacement[] | undefined,
  workspace: WorkspaceReader | undefined,
): CompositionLayer {
  return {
    id: 'compositions',
    build(context) {
      const warnings: string[] = [];
      const placements =
        given ?? placementsOf(context.plan.compositions ?? [], workspace, (note) => warnings.push(note));
      if (placements.length === 0) return ok(layerOutput({ warnings }));
      const markup: string[] = [];
      const css: string[] = [];
      const tweens: MotionTween[] = [];
      const splits: SplitSpec[] = [];
      const fonts = new Set<CaptionFontId>([TEXT_FONT]);
      const links: Record<string, LayerLink> = {};
      const textStack = familyListOf(context.fonts ? context.fonts.stack(TEXT_FONT) : fontStack(TEXT_FONT));
      for (const placement of placements) {
        const scope = compositionElementId(placement.itemId);
        const prefix = `${scope}-`;
        const { composition } = placement;
        const values = valuesOf(composition.doc.variables, placement.values, (note) =>
          warnings.push(`composition ${placement.itemId}: ${note}`),
        );
        const window = windowSeconds(placement.span.start, placement.span.end, context.rate);
        markup.push(
          element(
            'div',
            {
              id: scope,
              class: 'clip tc-comp',
              'data-tc-composition': true,
              ...(placement.sourceStart !== undefined ? { 'data-tc-program': true } : {}),
              'data-start': window.start,
              'data-duration': window.duration,
            },
            markupOf(placement, context, prefix, values),
          ),
        );
        const custom = composition.doc.variables
          .filter((param) => param.type === 'colour' || param.type === 'number')
          .map((param) => ` --${param.name}: ${String(values.get(param.name))};`)
          .join('');
        css.push(
          `#${scope} { z-index: ${Z.graphics}; font-family: ${textStack};${custom}${fitted(composition, context)} }`,
        );
        // The page's .clip places Taalcut's own clips; inside a composition the class is the composition's to style.
        css.push(`#${scope} .clip { position: static; left: auto; top: auto; width: auto; height: auto; }`);
        for (const rule of composition.rules)
          css.push(
            `${scopedSelectors(rule.selectors, scope, prefix)} { ${rule.declarations
              .map(
                ([property, value]) =>
                  `${property}: ${property === 'font-family' ? fontFamily(value, context.fonts) : withAssetUrls(value, placement.assets ?? {})};`,
              )
              .join(' ')} }`,
          );
        tweens.push(...placedTweens(placement, context, prefix));
        splits.push(...composition.motion.splits.map((split) => ({ ...split, id: prefix + split.id })));
        for (const font of composition.fonts) fonts.add(font);
        for (const asset of Object.values(placement.assets ?? {}))
          links[asset.bundlePath] = { source: asset.source, key: asset.key };
      }
      return ok(layerOutput({ markup, css, motion: { tweens, splits }, links, fonts: [...fonts], warnings }));
    },
  };
}
