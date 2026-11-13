// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The timeline calls of a composition's script in the order it makes them (HFW1 lower): its labels with their
 * positions, each call's place in that order (a chain `tl.to(…).addLabel(…)` runs left to right, so the method
 * name's offset orders it), and the timeline's `defaults.ease`. What a position can't be placed for says why.
 */
import { refusal, type WorkspaceFinding } from '../gate/finding';
import type { TimelineCall } from './positions';
import { nodesOf, type Node } from './statements';

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string';

const nameOf = (node: unknown): unknown =>
  isNode(node)
    ? node.type === 'Identifier'
      ? node.name
      : node.type === 'Literal'
        ? node.value
        : undefined
    : undefined;

/** Where a call sits in the order the script makes calls: its method name's offset. */
export function callOrder(call: Node | undefined): number {
  const callee = call?.callee;
  return isNode(callee) && isNode(callee.property) ? callee.property.start : Number.MAX_SAFE_INTEGER;
}

/** The identifier a call chain starts from (`tl` in `tl.to(…).addLabel(…)`). */
function chainRoot(node: unknown): string | undefined {
  let at: unknown = node;
  while (isNode(at) && (at.type === 'CallExpression' || at.type === 'MemberExpression'))
    at = at.type === 'CallExpression' ? at.callee : at.object;
  return isNode(at) && at.type === 'Identifier' ? (at.name as string) : undefined;
}

/** A literal number or string (numbers may be negative). */
function positionOf(node: Node | undefined): number | string | undefined | null {
  if (!node) return undefined;
  if (node.type === 'Literal' && (typeof node.value === 'number' || typeof node.value === 'string'))
    return node.value;
  if (node.type === 'UnaryExpression' && node.operator === '-' && isNode(node.argument)) {
    const inner = positionOf(node.argument);
    return typeof inner === 'number' ? -inner : null;
  }
  return null;
}

/** The script's `tl.addLabel(name, position?)` calls, with their place in the call order. */
export function labelCalls(
  program: Node,
  timeline: string,
  findings: WorkspaceFinding[],
): { order: number; call: TimelineCall }[] {
  const labels: { order: number; call: TimelineCall }[] = [];
  for (const node of nodesOf(program)) {
    if (node.type !== 'CallExpression' || !isNode(node.callee) || node.callee.type !== 'MemberExpression')
      continue;
    if (nameOf(node.callee.property) !== 'addLabel' || chainRoot(node.callee.object) !== timeline) continue;
    const [label, position] = (node.arguments as Node[] | undefined) ?? [];
    const name = nameOf(label);
    const at = positionOf(position);
    if (typeof name !== 'string' || at === null) {
      findings.push(
        refusal(
          'lower.label',
          'a label has a name or position that is not written out',
          'Write tl.addLabel("name", seconds) or tl.addLabel("name", "+=s").',
        ),
      );
      continue;
    }
    labels.push({ order: callOrder(node), call: { kind: 'label', name, position: at } });
  }
  return labels;
}

/** The timeline's `defaults.ease` (`gsap.timeline({ defaults: { ease } })`), when written. */
export function timelineDefaultsEase(program: Node): string | undefined {
  for (const node of nodesOf(program)) {
    if (node.type !== 'CallExpression' || !isNode(node.callee) || node.callee.type !== 'MemberExpression')
      continue;
    if (nameOf(node.callee.object) !== 'gsap' || nameOf(node.callee.property) !== 'timeline') continue;
    const [options] = (node.arguments as Node[] | undefined) ?? [];
    if (options?.type !== 'ObjectExpression') return undefined;
    const defaults = (options.properties as Node[]).find((property) => nameOf(property.key) === 'defaults');
    const value = defaults?.value;
    if (!isNode(value) || value.type !== 'ObjectExpression') return undefined;
    const ease = (value.properties as Node[]).find((property) => nameOf(property.key) === 'ease');
    const written = ease ? nameOf(ease.value) : undefined;
    return typeof written === 'string' ? written : undefined;
  }
  return undefined;
}

export const POSITION_PROBLEMS = {
  percent: 'is placed by a percent of another tween',
  unknownEnd:
    'is placed from an end that depends on the words (a stagger over a split before it), or a position not written out',
  negative: 'starts before the timeline does',
} as const;

export const POSITION_HINTS = {
  percent: 'Give the position as seconds, a label, "+=s", "<" or ">" (percent offsets do not lower).',
  unknownEnd:
    'After a stagger over a split’s lines, words or chars, give each position as seconds, a label added at seconds, ' +
    'or "<" from the tween before.',
  negative: 'Give the tween a position at or after 0.',
} as const;
