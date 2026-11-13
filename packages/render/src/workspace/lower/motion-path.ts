// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A tween's `motionPath` (HFW1 lower), read from the script itself: HyperFrames' parser keeps only point lists (as
 * keyframes), so a path is read from the tween's vars. MotionPathPlugin (GSAP_LOCK) moves the target along SVG path
 * data, its coordinates added to the target's own place, as it does with a `<path>` given without `align`; so a
 * path is the data, or `#id` of a `<path>` in the composition (its `d`). `autoRotate`, `start` and `end` lower as
 * written; `align`, point lists and curviness do not lower, and are refused with what to write instead.
 */
import type { MotionPathValue } from '../../motion/motion-data';
import { PATH_DATA } from '../../motion/motion-values';
import type { Node } from './statements';
import { selectElements, type TargetIndex } from './targets';

const PATH = new RegExp(`^${PATH_DATA}$`);

const keyOf = (property: Node): unknown =>
  (property.key as Node | undefined)?.name ?? (property.key as Node | undefined)?.value;

/** A literal's value (numbers may be negative). */
function literalValue(node: Node | undefined): unknown {
  if (!node) return undefined;
  if (node.type === 'Literal') return node.value;
  if (node.type === 'UnaryExpression' && node.operator === '-') {
    const inner = literalValue(node.argument as Node);
    return typeof inner === 'number' ? -inner : undefined;
  }
  return undefined;
}

/** The `motionPath` property of a tween's vars, when it has one. */
export function motionPathNode(vars: Node | undefined): Node | undefined {
  if (vars?.type !== 'ObjectExpression') return undefined;
  const property = (vars.properties as Node[]).find((candidate) => keyOf(candidate) === 'motionPath');
  return property?.value as Node | undefined;
}

/** A path written as data or as `#id` of one of the composition's paths, as path data; or why not. */
function pathData(path: unknown, index: TargetIndex): string | { problem: string } {
  if (typeof path !== 'string') return { problem: 'gives a path that is not a string' };
  if (path.startsWith('#')) {
    const [element] = selectElements(index, path) ?? [];
    const d = element?.tag === 'path' ? element.attributes.d : undefined;
    if (d === undefined) return { problem: `follows ${path.slice(0, 30)}, which is not a <path> here` };
    if (element?.attributes.transform !== undefined)
      return { problem: `follows ${path}, which is transformed` };
    path = d;
  }
  const data = String(path).trim();
  return PATH.test(data)
    ? data
    : { problem: 'gives path data with relative (lowercase) or unknown commands' };
}

export const MOTION_PATH_HINT =
  'Give motionPath a path in absolute commands ("M0,0 C40,-60 160,-60 200,0") or "#id" of a <path> here, with ' +
  'autoRotate (true or false), start and end (0–1) if needed; align, point lists and curviness do not lower.';

/** The motion path value tc.js takes, or the problem. */
export function lowerMotionPath(
  node: Node,
  index: TargetIndex,
  cubicPaths = false,
): MotionPathValue | { problem: string } {
  let pointList = false;
  const value: { path?: unknown; type?: unknown; autoRotate: unknown; start: unknown; end: unknown } = {
    autoRotate: false,
    start: 0,
    end: 1,
  };
  if (node.type === 'ObjectExpression') {
    for (const property of node.properties as Node[]) {
      const key = keyOf(property);
      if (
        key !== 'path' &&
        key !== 'autoRotate' &&
        key !== 'start' &&
        key !== 'end' &&
        !(cubicPaths && key === 'type')
      )
        return { problem: `sets motionPath.${String(key)}` };
      const raw = property.value as Node;
      if (key === 'path' && raw.type === 'ArrayExpression') pointList = true;
      value[key as keyof typeof value] =
        cubicPaths && key === 'path' && raw.type === 'ArrayExpression' ? cubicData(raw) : literalValue(raw);
    }
  } else if (node.type === 'Literal') value.path = node.value;
  else return { problem: 'gives motionPath a point list or a value that is not written out' };
  if (value.type !== undefined && value.type !== 'cubic')
    return { problem: 'uses an unsupported motion path type' };
  if (pointList && value.type !== 'cubic') return { problem: 'requires explicit cubic control points' };
  const path = pathData(value.path, index);
  if (typeof path !== 'string') return path;
  const { autoRotate, start, end } = value;
  if (typeof autoRotate !== 'boolean') return { problem: 'sets autoRotate to something but true or false' };
  if (
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  )
    return { problem: 'sets start or end to something but a number' };
  return { path, autoRotate, start, end };
}

/** SDK 0.8.209 writes cubic control points as static coordinate objects. No expressions are evaluated. */
function cubicData(node: Node): string | undefined {
  const elements = node.elements as (Node | null)[];
  if (elements.length < 4 || elements.length > 301 || (elements.length - 1) % 3 !== 0) return undefined;
  const points: { x: number; y: number }[] = [];
  for (const element of elements) {
    if (element?.type !== 'ObjectExpression') return undefined;
    const point: Record<string, number> = {};
    for (const property of element.properties as Node[]) {
      const key = keyOf(property);
      const value = literalValue(property.value as Node);
      if ((key !== 'x' && key !== 'y') || typeof value !== 'number' || !Number.isFinite(value))
        return undefined;
      point[key] = value;
    }
    if (point.x === undefined || point.y === undefined) return undefined;
    points.push({ x: point.x, y: point.y });
  }
  return points
    .map((point, index) => `${index === 0 ? 'M' : index % 3 === 1 ? 'C' : ''}${point.x},${point.y}`)
    .join(' ');
}
