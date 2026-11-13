// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A workspace composition file read into its parts (HFW1 gate): HyperFrames' sub-composition shape, one
 * `<template>` holding one `<style>`, one root element and one `<script>`, with the variables declared on `<html>`
 * (`data-composition-variables`). The root's markup is parsed by DSG1's parser under the workspace's rules, so
 * nothing outside the allowlist survives to a page; the style and the script are returned as text for the CSS
 * parse and the lowering. The root names its id, size and duration; nested compositions are refused.
 */
import type { GraphicParam } from '@taalcut/core';
import { parseMarkup, walk, type MarkupNode, type MarkupRules } from '../html/markup';
import { excerpt, refusal, type Gated, type WorkspaceFinding } from './finding';
import { markupFixHint, WORKSPACE_MARKUP, WORKSPACE_MARKUP_LIMITS } from './markup-rules';

export const COMPOSITION_LIMITS = {
  minSeconds: 0.5,
  maxSeconds: 600,
  variables: 16,
} as const;

export interface CompositionDocument {
  /** The root's `data-composition-id` (the key its timeline is registered under). */
  readonly compositionId: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  /** The variables, as Taalcut's graphic parameters (HyperFrames' `id` is the parameter's name). */
  readonly variables: readonly GraphicParam[];
  /** The `<style>` block's text ('' without one). */
  readonly style: string;
  /** The root element, its attributes as written. */
  readonly root: MarkupNode;
  /** The one inline script. */
  readonly script: string;
}

const fail = (findings: WorkspaceFinding[]): Gated<never> => ({ ok: false, findings });

const ELEMENT_BLOCK = (tag: string) => new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}\\s*>`, 'gi');

/** HyperFrames' declared variables, mapped to graphic parameters; findings for any it can't take. */
function readVariables(html: string, findings: WorkspaceFinding[]): GraphicParam[] {
  const tag = /<html\b[^>]*?\sdata-composition-variables\s*=\s*(?:'([^']*)'|"([^"]*)")/i.exec(html);
  if (!tag) return [];
  const raw = (tag[1] ?? tag[2] ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  const hint = 'Declare variables as a JSON array of {"id","type","label","default"} on <html>.';
  let declared: unknown;
  try {
    declared = JSON.parse(raw);
  } catch {
    findings.push(refusal('gate.variables', 'data-composition-variables is not JSON', hint));
    return [];
  }
  if (!Array.isArray(declared) || declared.length > COMPOSITION_LIMITS.variables) {
    findings.push(
      refusal('gate.variables', `data-composition-variables is not an array of at most 16`, hint),
    );
    return [];
  }
  const params: GraphicParam[] = [];
  for (const entry of declared as Record<string, unknown>[]) {
    const name = typeof entry?.id === 'string' ? entry.id : '';
    if (!/^[a-z][a-zA-Z0-9]{0,23}$/.test(name)) {
      findings.push(
        refusal(
          'gate.variables',
          `the variable id "${excerpt(name, 30)}" is not a camelCase name`,
          'Name variables in camelCase, starting with a lower-case letter, at most 24 characters (title, accentColour).',
        ),
      );
      continue;
    }
    const value = entry.default;
    const param = paramOf(name, entry.type, value, entry.options);
    if (param) params.push(param);
    else
      findings.push(
        refusal(
          'gate.variables',
          `the variable ${name} (${String(entry.type)}) has no default Taalcut can use`,
          'Give each variable a type of string, color, number, boolean or enum and a default of that type ' +
            '(a color is #rrggbb).',
        ),
      );
  }
  return params;
}

function paramOf(name: string, type: unknown, value: unknown, options: unknown): GraphicParam | null {
  switch (type) {
    case 'string':
      return typeof value === 'string' && value.trim().length > 0 && value.length <= 500
        ? { type: 'text', name, maxLength: 500, sample: value.trim() }
        : null;
    case 'color':
      return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
        ? { type: 'colour', name, default: value.toLowerCase() as `#${string}` }
        : null;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? { type: 'number', name, min: Math.min(value, -1e6), max: Math.max(value, 1e6), default: value }
        : null;
    case 'boolean':
      return typeof value === 'boolean' ? { type: 'boolean', name, default: value } : null;
    case 'enum': {
      const values = Array.isArray(options)
        ? options.map((option: unknown) =>
            typeof option === 'object' && option !== null ? Reflect.get(option, 'value') : option,
          )
        : [];
      const valid = values.every(
        (option) => typeof option === 'string' && /^[a-z][a-zA-Z0-9-]{0,23}$/.test(option),
      );
      return valid && values.length >= 2 && values.length <= 8 && values.includes(value)
        ? { type: 'enum', name, options: values as string[], default: value as string }
        : null;
    }
    default:
      return null;
  }
}

/** The template's inner text, or a finding. */
function templateOf(html: string): { inner: string } | { finding: WorkspaceFinding } {
  const blocks = [...html.matchAll(ELEMENT_BLOCK('template'))];
  if (blocks.length !== 1)
    return {
      finding: refusal(
        'gate.template',
        blocks.length === 0 ? 'the file has no <template>' : 'the file has more than one <template>',
        'Write one sub-composition: <template> holding a <style>, the root <div id="root" data-composition-id=…> ' +
          'and one <script>.',
      ),
    };
  return { inner: blocks[0]![2] ?? '' };
}

function refuseOutside(html: string, findings: WorkspaceFinding[]): void {
  if (/<link\b/i.test(html))
    findings.push(
      refusal('gate.link', 'the file has a <link>', 'Remove it: Taalcut loads the bundled fonts and GSAP.'),
    );
  for (const script of html.matchAll(/<script\b([^>]*)>/gi))
    if (/\bsrc\s*=/i.test(script[1] ?? ''))
      findings.push(
        refusal(
          'gate.scriptSrc',
          `a <script src> (${excerpt(script[0], 50)})`,
          'Remove it: GSAP and its plugins (SplitText, DrawSVG, MorphSVG, MotionPath, CustomEase) are loaded by ' +
            'Taalcut; write the one timeline script inline.',
        ),
      );
  for (const tag of [
    'iframe',
    'object',
    'embed',
    'video',
    'audio',
    'canvas',
    'form',
    'input',
    'base',
    'meta http-equiv',
  ])
    if (new RegExp(`<${tag}\\b`, 'i').test(html.replace(/<head\b[\s\S]*?<\/head>/i, '')))
      findings.push(
        refusal(
          'gate.tag',
          `the file has <${tag.split(' ')[0]}>`,
          'Remove it: a graphic composition draws HTML and SVG only.',
        ),
      );
}

/** Reads a composition file into its parts, or every reason it can't be. */
export interface CompositionProfile {
  readonly maxSeconds?: number;
  readonly markup?: MarkupRules;
  readonly markupLimits?: { readonly nodes: number; readonly depth: number };
  readonly tweens?: number;
  readonly maxCssRules?: number;
  readonly cubicPaths?: boolean;
}

export function readComposition(html: string, profile: CompositionProfile = {}): Gated<CompositionDocument> {
  const findings: WorkspaceFinding[] = [];
  refuseOutside(html, findings);
  const variables = readVariables(html, findings);
  const template = templateOf(html);
  if ('finding' in template) return fail([...findings, template.finding]);
  let inner = template.inner.replace(/<!--[\s\S]*?-->/g, '');
  const styles = [...inner.matchAll(ELEMENT_BLOCK('style'))];
  const scripts = [...inner.matchAll(ELEMENT_BLOCK('script'))];
  if (styles.length > 1)
    findings.push(
      refusal('gate.style', 'the template has more than one <style>', 'Merge the styles into one <style>.'),
    );
  if (scripts.length !== 1)
    findings.push(
      refusal(
        'gate.script',
        scripts.length === 0 ? 'the template has no <script>' : 'the template has more than one <script>',
        'Write one <script> that builds one paused timeline and registers it on window.__timelines.',
      ),
    );
  if (scripts.some((script) => (script[1] ?? '').trim() !== ''))
    findings.push(
      refusal('gate.script', 'the <script> has attributes', 'Write a plain <script> with no type or src.'),
    );
  for (const block of [...styles, ...scripts]) inner = inner.replace(block[0], '');
  const parsed = parseMarkup(
    inner,
    profile.markupLimits ?? WORKSPACE_MARKUP_LIMITS,
    profile.markup ?? WORKSPACE_MARKUP,
  );
  if (!parsed.ok)
    return fail([
      ...findings,
      refusal('gate.markup', `the markup has ${parsed.problem}`, markupFixHint(parsed.problem)),
    ]);
  const roots = parsed.nodes;
  const root = roots[0];
  if (
    roots.length !== 1 ||
    !root ||
    root.tag !== 'div' ||
    root.attributes['data-composition-id'] === undefined
  )
    return fail([
      ...findings,
      refusal(
        'gate.root',
        'the template does not hold exactly one root <div> with data-composition-id',
        'Put every element inside one <div id="root" data-composition-id="…" data-width="1080" data-height="1920" ' +
          'data-duration="…">.',
      ),
    ]);
  for (const node of walk(root.children))
    if (
      ['data-composition-id', 'data-width', 'data-height'].some((name) => node.attributes[name] !== undefined)
    )
      findings.push(
        refusal(
          'gate.nested',
          `<${node.tag}> inside the root names a composition or a canvas size`,
          'Write one composition per file; nested compositions are not supported.',
        ),
      );
  const width = Number(root.attributes['data-width'] ?? '1080');
  const height = Number(root.attributes['data-height'] ?? '1920');
  const durationSeconds = Number(root.attributes['data-duration'] ?? Number.NaN);
  const maxSeconds = profile.maxSeconds ?? COMPOSITION_LIMITS.maxSeconds;
  if (!(durationSeconds >= COMPOSITION_LIMITS.minSeconds && durationSeconds <= maxSeconds))
    findings.push(
      refusal(
        'gate.duration',
        `the root's data-duration is ${root.attributes['data-duration'] ?? 'missing'}`,
        `Set data-duration on the root to the graphic's length in seconds, ${COMPOSITION_LIMITS.minSeconds} to ` +
          `${maxSeconds}.`,
      ),
    );
  if (findings.length > 0) return fail(findings);
  return {
    ok: true,
    value: {
      compositionId: root.attributes['data-composition-id'] ?? '',
      width,
      height,
      durationSeconds,
      variables,
      style: styles[0]?.[2] ?? '',
      root,
      script: scripts[0]?.[2] ?? '',
    },
    warnings: [],
  };
}
