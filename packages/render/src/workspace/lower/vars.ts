// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A tween's values and timing as motion data (HFW1 lower): each property the parser read becomes a MotionVars entry
 * when tc.js's allowlist takes it (motion-values.ts checks the value), lengths written as strings with px become
 * numbers where GSAP takes numbers, and the ease becomes a name tc.js knows (GSAP's default, power1.out, when none
 * is written). What can't be lowered comes back as a refusal with what to write instead.
 */
import {
  CUBIC_BEZIER,
  EASE_PATTERN,
  EASES,
  MOTION_PROPERTIES,
  STAGGER_ORDERS,
} from '../../motion/motion-data';
import type { MotionProperty, MotionStagger, MotionValue, StaggerOrder } from '../../motion/motion-data';
import { NUMBER_PROPERTIES, valueAllowed } from '../../motion/motion-values';
import { excerpt, refusal, type WorkspaceFinding } from '../gate/finding';

/** GSAP's default ease. */
export const DEFAULT_EASE = 'power1.out';

const PROPERTY_SET: ReadonlySet<string> = new Set(MOTION_PROPERTIES);
const NAMED_EASES: ReadonlySet<string> = new Set(EASES);

/** GSAP's aliases for the transform names Taalcut uses. */
const ALIASES: Readonly<Record<string, MotionProperty>> = {
  rotate: 'rotation',
  rotationZ: 'rotation',
  alpha: 'opacity',
};

const PX = /^(-?(?:\d+\.?\d*|\.\d+))(?:px)?$/;
const DEG = /^(-?(?:\d+\.?\d*|\.\d+))(?:deg)?$/;

function asNumber(property: MotionProperty, value: string): number | undefined {
  const pattern = property.startsWith('rotation') || property.startsWith('skew') ? DEG : PX;
  const match = pattern.exec(value.trim());
  return match ? Number(match[1]) : undefined;
}

export interface LoweredVars {
  readonly vars: Partial<Record<MotionProperty, MotionValue>>;
  readonly findings: WorkspaceFinding[];
}

/** One tween's property record (the parser's `properties` or `fromProperties`) as motion vars. */
export function lowerVars(properties: Readonly<Record<string, number | string>>, where: string): LoweredVars {
  const vars: Partial<Record<MotionProperty, MotionValue>> = {};
  const findings: WorkspaceFinding[] = [];
  for (const [key, raw] of Object.entries(properties)) {
    const property = (ALIASES[key] ?? key) as MotionProperty;
    if (!PROPERTY_SET.has(property)) {
      findings.push(
        refusal(
          'lower.property',
          `${where} animates ${key}, which tc.js does not apply`,
          `Animate one of: ${MOTION_PROPERTIES.join(', ')}. Change other styles in CSS, or move an inner element.`,
        ),
      );
      continue;
    }
    if (typeof raw === 'string' && raw.startsWith('__raw:')) {
      findings.push(
        refusal(
          'lower.value',
          `${where} sets ${key} to an expression (${excerpt(raw.slice(6), 40)})`,
          'Write the value as a literal number or string: no functions, no variables the script computes.',
        ),
      );
      continue;
    }
    if (typeof raw === 'string' && /^[+\-*/]=/.test(raw)) {
      findings.push(
        refusal(
          'lower.value',
          `${where} sets ${key} relative to its current value (${raw})`,
          'Write the absolute value: use fromTo with both ends.',
        ),
      );
      continue;
    }
    const value: MotionValue | undefined =
      NUMBER_PROPERTIES.has(property) && typeof raw === 'string' ? asNumber(property, raw) : raw;
    if (value === undefined || !valueAllowed(property, value)) {
      findings.push(
        refusal(
          'lower.value',
          `${where} sets ${key} to ${excerpt(String(raw), 40)}`,
          NUMBER_PROPERTIES.has(property)
            ? `Give ${key} a number (pixels or degrees).`
            : `Give ${key} a plain value: a length (px, %, em), a colour (#rrggbb, rgb()), or path data as the property takes.`,
        ),
      );
      continue;
    }
    vars[property] = value;
  }
  return { vars, findings };
}

/** The ease as tc.js takes it, or a refusal. */
export function lowerEase(
  ease: string | undefined,
  where: string,
): { ease: string } | { finding: WorkspaceFinding } {
  if (ease === undefined) return { ease: DEFAULT_EASE };
  if (NAMED_EASES.has(ease) || EASE_PATTERN.test(ease) || CUBIC_BEZIER.test(ease)) return { ease };
  return {
    finding: refusal(
      'lower.ease',
      `${where} uses the ease ${excerpt(ease, 40)}`,
      'Use a GSAP ease by name (power1–4, sine, expo, circ, back, elastic, bounce with .in, .out or .inOut, ' +
        'steps(n)) or cubic-bezier(x1, y1, x2, y2).',
    ),
  };
}

/** The stagger the parser kept as raw source (`__raw:0.05`, `__raw:{ each: 0.05, from: "center" }`). */
export function lowerStagger(
  raw: unknown,
  where: string,
): { stagger: MotionStagger } | { finding: WorkspaceFinding } {
  const fail = {
    finding: refusal(
      'lower.stagger',
      `${where} staggers with ${excerpt(String(raw).replace(/^__raw:/, ''), 40)}`,
      'Stagger with a number of seconds, or { each: s } or { amount: s } with from "start", "end", "center" or ' +
        '"edges" (no grid, no function, no random).',
    ),
  };
  const source =
    typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.replace(/^__raw:/, '') : '';
  const plain = /^\s*(\d+(?:\.\d+)?)\s*$/.exec(source);
  if (plain) return { stagger: { each: Number(plain[1]), from: 'start' } };
  const object = /^\s*\{([^{}]*)\}\s*$/.exec(source);
  if (!object) return fail;
  const fields: Record<string, string> = {};
  for (const part of (object[1] ?? '').split(',')) {
    if (part.trim() === '') continue;
    const pair = /^\s*["']?([a-zA-Z]+)["']?\s*:\s*(.+?)\s*$/.exec(part);
    if (!pair) return fail;
    fields[pair[1] ?? ''] = (pair[2] ?? '').replace(/^["']|["']$/g, '');
  }
  const from = (fields.from ?? 'start') as StaggerOrder;
  if (
    !STAGGER_ORDERS.includes(from) ||
    Object.keys(fields).some((key) => !['each', 'amount', 'from'].includes(key))
  )
    return fail;
  const each = fields.each === undefined ? undefined : Number(fields.each);
  const amount = fields.amount === undefined ? undefined : Number(fields.amount);
  if (each !== undefined && amount === undefined && Number.isFinite(each) && each >= 0)
    return { stagger: { each, from } };
  if (amount !== undefined && each === undefined && Number.isFinite(amount) && amount >= 0)
    return { stagger: { amount, from } };
  return fail;
}
