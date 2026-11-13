// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-TPL, the retire step's guard: nothing the kit and DSG1's designs were made of is still exported or still on
 * disk, and the only graphic anything can make is a composition (the owner: "we should never hard code any
 * components that is needed for the video. that is something the AI would make dynamically"). The make's half is
 * timeline's `test/hfw1-retire-guard.test.ts`.
 *
 * On since the retire commit (the coordinator, 2026-11-03: off until dsn's Designer and `graphics.design` landed).
 * The overlay's graphic brief (`ui/templates/graphic-brief.tsx`, `graphic-words.ts`) stays: it is the reading the
 * template's Designer designs from, not a kit.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as core from '@taalcut/core';
import * as render from '@taalcut/render';
import * as timeline from '@taalcut/timeline';
import { describe, expect, it } from 'vitest';

const RETIRED = true;
const ROOT = join(import.meta.dirname, '..', '..', '..');

/** Runtime exports the retire step deletes (ctr's list, `_orch/hfw1/reports/ctr.md`, and tpl's). */
const DELETED: Record<'core' | 'render' | 'timeline', readonly string[]> = {
  core: [
    'GRAPHIC_KINDS',
    'OVERLAY_GRAPHIC_KINDS',
    'MOTION_DESIGN_GRAPHIC_KINDS',
    'GRAPHIC_MOTION_CHOICES',
    'CALLOUT_SHAPES',
    'CALL_TO_ACTION_ICONS',
    'graphicDesignSchema',
    'graphicFieldsSchema',
    'isKitGraphic',
    'GRAPHIC_ENTRANCES',
    'GRAPHIC_REVEAL_UNITS',
    'GRAPHIC_FEELS',
    'GRAPHIC_ORDERS',
    'GRAPHIC_EXITS',
    'graphicMotionSchema',
    'GRAPHIC_KIT_REASONS',
    'GRAPHIC_COMPONENT_FORMAT',
    'graphicComponentSourceSchema',
    'GRAPHIC_CHECKS',
    'graphicValidationSchema',
    'graphicComponentSchema',
    'graphicComponentRefSchema',
    'GRAPHIC_COMPONENT_ROLES',
    'validateGraphicInputSchema',
    'validateGraphicOutputSchema',
  ],
  render: [
    'defineGraphic',
    'GRAPHICS',
    'graphicFor',
    'latestGraphic',
    'DEFAULT_LOOK',
    'resolveLook',
    'planGraphics',
    'layoutGraphics',
    'layoutOrNoRoom',
    'graphicFacts',
    'graphicMetrics',
    'graphicScale',
    'graphicsLayer',
    'placeGraphics',
    'estimatedCaptionBoxes',
    'createGraphicsCommands',
    'graphicsToolModule',
    'CREATE_KINDS',
    'countSteps',
    'AUTHORED_LIMITS',
    'authoredDocSchema',
    'parseDoc',
    'lintComponent',
    'definitionOf',
    'validateComponent',
    'VALIDATOR_VERSION',
    'designGraphic',
    'DESIGN_ROUNDS',
    'designGroups',
    'designTemplateGraphics',
    'DESIGN_SYSTEM_PROMPT',
    'restyleGraphic',
    'restyleRequest',
    'validateGraphicOn',
  ],
  timeline: ['graphicKindFor', 'graphicFootprint'],
};

/** Files and folders the retire step deletes (or moves, for what the workspace still reads). */
const GONE = [
  'packages/core/src/timeline/graphic-motion.ts',
  'packages/core/src/render/validate-graphic.ts',
  'packages/render/src/graphics/components',
  'packages/render/src/graphics/create',
  'packages/render/src/graphics/authored/design',
  'packages/render/src/graphics/registry.ts',
  'packages/render/src/graphics/define-graphic.ts',
  'packages/timeline/src/assembly/placement/size.ts',
  'packages/ui/src/media/graphic-choices.ts',
  'packages/ui/src/media/graphic-labels.ts',
  'packages/ui/src/media/graphic-motion.tsx',
  'apps/desktop/src/utility/roots/agent-graphic-design.ts',
];

const exported = { core, render, timeline } as unknown as Record<string, Record<string, unknown>>;

describe.skipIf(!RETIRED)('the retire step’s guard (HFW1 tpl)', () => {
  it('exports none of the kit’s or DSG1’s names', () => {
    for (const [pkg, names] of Object.entries(DELETED))
      expect(
        names.filter((name) => name in exported[pkg]!),
        `@taalcut/${pkg}`,
      ).toEqual([]);
  });

  it('leaves none of their files', () => {
    expect(GONE.filter((path) => existsSync(join(ROOT, path)))).toEqual([]);
  });

  it('makes a graphic only as a composition', () => {
    // No command makes a kit graphic or swaps its component.
    expect(Object.keys(core.GRAPHICS_COMMANDS)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(add|propose|setComponent)$/)]),
    );
    // A proposal is a composition's.
    expect(core.GRAPHIC_PROPOSAL_DESIGNS as readonly string[]).not.toContain('kit');
    // A template's graphic use names a composition.
    const overlayId = core.newId<'TextOverlay'>();
    expect(core.graphicComponentUseSchema.safeParse({ overlayId }).success).toBe(false);
    // A graphic item is a composition's, with nothing a kit drew it from.
    const item = {
      type: 'graphic',
      id: core.newId<'TimelineItem'>(),
      anchor: { kind: 'time', at: core.RationalTime.of(0, { num: 30, den: 1 }) },
      start: core.RationalTime.of(0, { num: 30, den: 1 }),
      duration: core.RationalTime.of(60, { num: 30, den: 1 }),
      placement: { box: { x: 0.1, y: 0.1, width: 0.5, height: 0.05 } },
      styleKey: 'caption',
      language: 'en',
      origin: 'agent',
    };
    expect(core.graphicItemSchema.safeParse(item).success).toBe(false);
    const kit = core.graphicItemSchema.safeParse({
      ...item,
      composition: { id: core.newId<'GraphicComposition'>(), hash: 'c'.repeat(64), params: {} },
      component: { id: 'made-up', version: 1 },
      fields: { text: 'Made-up words' },
    });
    if (kit.success)
      expect(Object.keys(kit.data)).not.toEqual(expect.arrayContaining(['component', 'fields']));
  });
});
