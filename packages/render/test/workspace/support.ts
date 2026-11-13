// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Workspace fixtures for the hf lane's tests (HFW1): hand-written HyperFrames sub-compositions under
 * test/workspace/fixtures, gated and lowered, placed on a test timeline of one still clip.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RationalTime, type Timeline } from '@taalcut/core';
import type { CompositionPlacement } from '../../src/compile/layers/compositions';
import {
  compileComposition,
  type CompileOptions,
  type CompositionBundle,
} from '../../src/compile/composition';
import { gateHtml } from '../../src/workspace/gate/gate';
import type { PreparedComposition } from '../../src/workspace/gate/prepare';
import { presetFor } from '../../src/presets/presets.v1';
import { makeTimeline } from '../support/timeline';

export const FIXTURES = join(import.meta.dirname, 'fixtures');

export const fixtureText = (name: string) => readFile(join(FIXTURES, name), 'utf8');

/** A fixture gated and lowered; throws with the findings when the gate refuses it. */
export async function gatedFixture(name: string): Promise<PreparedComposition> {
  const gated = await gateHtml(await fixtureText(name), name);
  if (!gated.ok) throw new Error(`${name}: ${JSON.stringify(gated.findings, null, 1)}`);
  return gated.value;
}

/** One still clip of `frames` at 30 fps. */
export const stillTimeline = (frames: number): Timeline => makeTimeline({ items: [{ frames }] });

export const placement = (
  composition: PreparedComposition,
  span: { start: number; end: number },
  values: CompositionPlacement['values'] = {},
  itemId = 'ITEM1',
): CompositionPlacement => ({ itemId, span, composition, values });

/** Compiles `timeline` with the placements, every visual drawn by `still`. */
export function compileWith(
  timeline: Timeline,
  placements: readonly CompositionPlacement[],
  extra: Partial<CompileOptions> = {},
  still = '/nonexistent/still.png',
): CompositionBundle {
  const compiled = compileComposition(timeline, {
    variant: 'export',
    preset: presetFor('device'),
    burnCaptions: false,
    media: () => ({
      file: still,
      key: 'still',
      mediaStart: RationalTime.zero(timeline.canvas.rate),
      ext: 'png',
    }),
    compositions: placements,
    ...extra,
  });
  if (!compiled.ok) throw new Error(compiled.error.code);
  return compiled.value;
}
