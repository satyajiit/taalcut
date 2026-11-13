// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A composition's SplitText splits (HFW1 lower): `SplitText.create("#id", { type, mask })` on its own elements, as
 * split specs tc.js makes again in the page. Lines split as well as words and letters: tc.js splits once the
 * bundled fonts are ready (`document.fonts.ready`), so the lines break where the drawn words do, the same in the
 * preview and the export.
 */
import { SPLIT_TYPES, type SplitMask, type SplitType } from '../../motion/motion-data';
import { refusal, type WorkspaceFinding } from '../gate/finding';
import type { Node, SplitDeclaration } from './statements';
import { idsOf, selectElements, type TargetIndex } from './targets';

export interface Split {
  readonly ids: readonly string[];
  readonly spec: { readonly type: SplitType; readonly mask?: SplitMask };
}

export const SPLIT_UNITS = ['lines', 'words', 'chars'] as const;
export type SplitUnit = (typeof SPLIT_UNITS)[number];

export const literal = (node: Node | undefined): string | undefined =>
  node && node.type === 'Literal' && typeof node.value === 'string' ? node.value : undefined;

const isUnit = (unit: string): unit is SplitUnit => (SPLIT_UNITS as readonly string[]).includes(unit);

/** SplitText's options as a split type (its units in the order lines, words, chars) and mask, or why not. */
function splitOptions(options: Node | undefined): Split['spec'] | string {
  if (!options || options.type !== 'ObjectExpression') return 'has no options object with a type';
  let type: string | undefined;
  let mask: string | undefined;
  for (const property of options.properties as Node[]) {
    const key = (property.key as Node | undefined)?.name ?? (property.key as Node | undefined)?.value;
    const value = literal(property.value as Node);
    if (key === 'type') type = value;
    else if (key === 'mask') mask = value;
    else if (!['aria', 'wordsClass', 'charsClass', 'linesClass', 'tag'].includes(String(key)))
      return `sets ${String(key)}`;
  }
  const written = (type ?? '').split(',').map((unit) => unit.trim());
  if (written.length === 0 || !written.every(isUnit)) return `splits into ${type ?? 'nothing'}`;
  const units = SPLIT_UNITS.filter((unit) => written.includes(unit));
  const splitType = units.join(',') as SplitType;
  if (!(SPLIT_TYPES as readonly string[]).includes(splitType)) return `splits into ${type ?? 'nothing'}`;
  if (mask !== undefined && (!isUnit(mask) || !units.includes(mask))) return `masks ${mask}`;
  return mask === undefined ? { type: splitType } : { type: splitType, mask: mask as SplitMask };
}

export function readSplits(
  declarations: readonly SplitDeclaration[],
  index: TargetIndex,
  findings: WorkspaceFinding[],
): Map<string, Split> {
  const splits = new Map<string, Split>();
  for (const declaration of declarations) {
    const selector = literal(declaration.selector);
    const elements = selector === undefined ? null : selectElements(index, selector);
    const spec = splitOptions(declaration.options);
    if (!elements || elements.length === 0 || typeof spec === 'string') {
      findings.push(
        refusal(
          'lower.split',
          `the split ${declaration.name} ${typeof spec === 'string' ? spec : `selects ${selector ?? 'no selector'}, which matches nothing`}`,
          'Split with SplitText.create("#id", { type: "lines" | "words" | "chars" (or a list of them), ' +
            'mask?: one of its units }) on elements of this composition.',
        ),
      );
      continue;
    }
    splits.set(declaration.name, { ids: idsOf(index, elements), spec });
  }
  return splits;
}
