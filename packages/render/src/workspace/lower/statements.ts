// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The shape a composition's script may have (HFW1 lower, "code outside the tween calls"): every top-level
 * statement is one Taalcut knows: registering the GSAP_LOCK plugins, the one paused timeline, SplitText splits,
 * constants (literals and element queries the parser resolves), calls on the timeline, and registering it on
 * `window.__timelines`. Anything else would run only in HyperFrames and never in the lowered motion, so it is
 * refused with what to write instead. Clocks, randomness, the network and `eval` are named wherever they appear.
 * Nodes are acorn's ESTree, from HyperFrames' own parser.
 */
import { excerpt, refusal, type WorkspaceFinding } from '../gate/finding';

/** An ESTree node as acorn gives it (the parser's own `any`). */
export type Node = { readonly type: string; readonly start: number; readonly end: number } & Record<
  string,
  unknown
>;

export const LOCKED_PLUGINS = [
  'SplitText',
  'DrawSVGPlugin',
  'MorphSVGPlugin',
  'MotionPathPlugin',
  'CustomEase',
];

export interface SplitDeclaration {
  /** The variable the split is bound to. */
  readonly name: string;
  readonly selector: Node | undefined;
  readonly options: Node | undefined;
}

export interface ScriptShape {
  readonly splits: readonly SplitDeclaration[];
  readonly findings: readonly WorkspaceFinding[];
}

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string';

/** Every node under `root`, depth first. */
export function* nodesOf(root: Node): Generator<Node> {
  yield root;
  for (const [key, value] of Object.entries(root)) {
    if (key === 'loc') continue;
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) yield* nodesOf(item);
    } else if (isNode(value)) yield* nodesOf(value);
  }
}

const name = (node: unknown): string | undefined =>
  isNode(node) && node.type === 'Identifier' ? (node.name as string) : undefined;

const member = (node: unknown, object: string, property: string): boolean =>
  isNode(node) &&
  node.type === 'MemberExpression' &&
  name(node.object) === object &&
  (name(node.property) === property || (isNode(node.property) && node.property.value === property));

const FORBIDDEN: readonly {
  readonly test: (node: Node) => boolean;
  readonly what: string;
  readonly hint: string;
}[] = [
  {
    test: (node) => member(node, 'Math', 'random'),
    what: 'Math.random',
    hint: 'Write the values out: every frame must be the same on every render.',
  },
  {
    test: (node) => name(node) === 'Date' || member(node, 'performance', 'now'),
    what: 'a clock (Date, performance.now)',
    hint: 'Use the timeline’s own time: place tweens at positions, never read the clock.',
  },
  {
    test: (node) => ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].includes(name(node) ?? ''),
    what: 'the network',
    hint: 'Remove it: a composition loads nothing; use workspace assets and variables.',
  },
  {
    test: (node) => ['eval', 'Function'].includes(name(node) ?? '') || node.type === 'ImportExpression',
    what: 'eval or dynamic code',
    hint: 'Write the timeline as plain tween calls.',
  },
  {
    test: (node) =>
      ['setTimeout', 'setInterval', 'requestAnimationFrame', 'addEventListener'].includes(name(node) ?? '') ||
      (isNode(node) && node.type === 'MemberExpression' && name(node.property) === 'addEventListener'),
    what: 'timers or events',
    hint: 'Remove them: HyperFrames seeks the timeline; nothing may run on its own.',
  },
];

/** The clock, randomness, network and dynamic code anywhere in the script. */
export function forbiddenUses(program: Node, source: string): WorkspaceFinding[] {
  const found = new Map<string, WorkspaceFinding>();
  for (const node of nodesOf(program))
    for (const rule of FORBIDDEN)
      if (!found.has(rule.what) && rule.test(node))
        found.set(
          rule.what,
          refusal(
            'lower.forbidden',
            `the script uses ${rule.what} (${excerpt(source.slice(node.start, node.end), 40)})`,
            rule.hint,
          ),
        );
  return [...found.values()];
}

const isTimeline = (node: unknown): boolean =>
  isNode(node) && node.type === 'CallExpression' && member(node.callee, 'gsap', 'timeline');

const isSplit = (node: Node): boolean =>
  isNode(node) &&
  ((node.type === 'CallExpression' && member(node.callee, 'SplitText', 'create')) ||
    (node.type === 'NewExpression' && name(node.callee) === 'SplitText'));

const isQuery = (node: unknown): boolean =>
  isNode(node) &&
  node.type === 'CallExpression' &&
  isNode(node.callee) &&
  node.callee.type === 'MemberExpression' &&
  ['document', 'root'].includes(name(node.callee.object) ?? '') &&
  ['querySelector', 'querySelectorAll', 'getElementById'].includes(name(node.callee.property) ?? '');

/** A literal, or arithmetic over literals and names (the parser resolves constants). */
function isConstant(node: unknown): boolean {
  if (!isNode(node)) return false;
  if (node.type === 'Literal') return typeof node.value === 'number' || typeof node.value === 'string';
  if (node.type === 'Identifier') return true;
  if (node.type === 'UnaryExpression') return node.operator === '-' && isConstant(node.argument);
  if (node.type === 'BinaryExpression')
    return (
      ['+', '-', '*', '/'].includes(node.operator as string) &&
      isConstant(node.left) &&
      isConstant(node.right)
    );
  if (node.type === 'TemplateLiteral') return (node.expressions as unknown[]).length === 0;
  if (node.type === 'ArrayExpression') return (node.elements as unknown[]).every(isConstant);
  return false;
}

/** The root object of a chain of calls (`tl.to(…).to(…)` → `tl`). */
function chainRoot(node: unknown): string | undefined {
  let at: unknown = node;
  while (
    isNode(at) &&
    at.type === 'CallExpression' &&
    isNode(at.callee) &&
    at.callee.type === 'MemberExpression'
  )
    at = at.callee.object;
  return name(at);
}

const TIMELINE_METHODS = new Set(['to', 'from', 'fromTo', 'set', 'addLabel']);

function chainMethods(node: unknown): string[] {
  const methods: string[] = [];
  let at: unknown = node;
  while (
    isNode(at) &&
    at.type === 'CallExpression' &&
    isNode(at.callee) &&
    at.callee.type === 'MemberExpression'
  ) {
    methods.push(name(at.callee.property) ?? '?');
    at = at.callee.object;
  }
  return methods;
}

const isRegistry = (node: unknown) => member(node, 'window', '__timelines');

/** Classifies each top-level statement; the splits declared and every statement refused. */
export function checkStatements(program: Node, source: string, timeline: string): ScriptShape {
  const findings: WorkspaceFinding[] = [];
  const splits: SplitDeclaration[] = [];
  const outside = (node: Node, hint: string) =>
    findings.push(
      refusal(
        'lower.scriptShape',
        `code outside the tween calls: ${excerpt(source.slice(node.start, node.end))}`,
        hint,
      ),
    );
  for (const statement of program.body as Node[]) {
    if (statement.type === 'EmptyStatement') continue;
    if (statement.type === 'ExpressionStatement') {
      const expression = statement.expression as Node;
      if (expression.type === 'Literal' && expression.value === 'use strict') continue;
      if (expression.type === 'CallExpression' && member(expression.callee, 'gsap', 'registerPlugin')) {
        const unknown = (expression.arguments as Node[]).filter(
          (argument) => !LOCKED_PLUGINS.includes(name(argument) ?? ''),
        );
        if (unknown.length > 0)
          outside(statement, `Register only the bundled plugins: ${LOCKED_PLUGINS.join(', ')}.`);
        continue;
      }
      if (expression.type === 'CallExpression' && chainRoot(expression) === timeline) {
        const other = chainMethods(expression).filter((method) => !TIMELINE_METHODS.has(method));
        if (other.length > 0)
          outside(
            statement,
            `Use only tl.to, tl.from, tl.fromTo, tl.set and tl.addLabel (not ${other.join(', ')}): nested timelines, ` +
              'calls and callbacks do not lower.',
          );
        continue;
      }
      if (expression.type === 'AssignmentExpression') {
        const left = expression.left as Node;
        const target = left.type === 'MemberExpression' ? (left.object as Node) : undefined;
        // window.__timelines["id"] = tl; and window.__timelines = window.__timelines || {};
        if (target && isRegistry(target) && name(expression.right) === timeline) continue;
        if (isRegistry(left)) continue;
      }
      outside(
        statement,
        'Keep the script to the timeline: write the design in HTML and CSS, and motion as tweens.',
      );
      continue;
    }
    if (statement.type === 'VariableDeclaration') {
      for (const declarator of statement.declarations as Node[]) {
        const id = name(declarator.id);
        const init = declarator.init;
        if (!id || !isNode(init)) {
          outside(statement, 'Declare one named constant per statement, with a value.');
          continue;
        }
        if (isTimeline(init)) continue;
        if (isSplit(init)) {
          const args = init.arguments as Node[];
          splits.push({ name: id, selector: args[0], options: args[1] });
          continue;
        }
        if (isQuery(init) || isConstant(init)) continue;
        if (init.type === 'ObjectExpression') continue;
        outside(
          statement,
          'Declare only numbers, strings, element queries, SplitText splits and the timeline; compute nothing.',
        );
      }
      continue;
    }
    outside(
      statement,
      'Remove functions, loops and conditions: write each tween as its own call on the timeline (use stagger for ' +
        'groups).',
    );
  }
  return { splits, findings };
}
