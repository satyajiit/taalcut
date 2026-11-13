// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Tests for HyperFrames motion skills integration and tagged chat effects
 * (single and multiple) in @taalcut/agent.
 */
import {
  CHAT_EFFECT_IDS,
  GRAPHICS_DESIGN_TOOL,
  graphicsDesignJobSchema,
  newId,
  unwrap,
  type GraphicsDesignJob,
  type SelectionChip,
} from '@taalcut/core';
import {
  effectIdsFromSelections,
  effectSelectionLines,
  effectToolsFor,
  hasMotionTools,
  HYPERFRAMES_MOTION_SKILLS,
  selectionNote,
  systemPrompt,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { clipsModule } from '../support/fixtures';
import { call, harness, plan, registryFor, SOUL, turns } from '../support/harness';
import { videos } from '../timestamps/videos';
import { graphicsModule } from './graphics-module';

const v = videos();

describe('HyperFrames & Motionmaxxing motion doctrine in system prompts', () => {
  it('injects HYPERFRAMES_MOTION_SKILLS when motion or timeline tools are in the catalogue', () => {
    const withGraphics = registryFor([graphicsModule()]).catalogue();
    expect(hasMotionTools(withGraphics)).toBe(true);
    const prompt = systemPrompt(SOUL, withGraphics);
    expect(prompt).toContain('# HyperFrames & Motionmaxxing motion doctrine');
    expect(prompt).toContain('Vector Law (directional current)');
    expect(prompt).toContain('One-Take continuous carry & seam choreography');
    expect(prompt).toContain('Non-metronomic rhythm (burst vs. rest)');
    expect(prompt).toContain('Land decelerates, leave accelerates (Motionmaxxing measured curves)');
    expect(prompt).toContain('Meaning on the word, /humanizer pass & anti-slop rules (Motionmaxxing');
    expect(prompt).toContain('cut-the-curve');
    expect(prompt).toContain('captions-overlay');
    // HFW1: graphics are the Designer's, asked for in words; no kit fields or kinds to pick from.
    expect(prompt).toContain('Graphics are designed, never picked from a list');
    expect(HYPERFRAMES_MOTION_SKILLS).not.toContain('fields.motion');
    expect(HYPERFRAMES_MOTION_SKILLS).not.toContain('graphics.add');
  });

  it('omits HYPERFRAMES_MOTION_SKILLS for pure non-motion Phase 1 tool catalogues', () => {
    const clipsOnly = registryFor([clipsModule()]).catalogue();
    expect(hasMotionTools(clipsOnly)).toBe(false);
    const prompt = systemPrompt(SOUL, clipsOnly);
    expect(prompt).not.toContain(HYPERFRAMES_MOTION_SKILLS);
  });
});

describe('tagged chat effect chips (single and multiple)', () => {
  it('formats single and multiple effect selection chips in selectionNote and extracts their tools', () => {
    const clipId = newId<'TimelineItem'>();
    const selections: SelectionChip[] = [
      { kind: 'clip', timelineId: v.timeline.id, clipId },
      { kind: 'effect', effectId: 'kineticTitle' },
      { kind: 'effect', effectId: 'wordSwap' },
      { kind: 'effect', effectId: 'popCaptions' },
    ];

    expect(effectIdsFromSelections(selections)).toEqual(['kineticTitle', 'wordSwap', 'popCaptions']);
    expect(effectSelectionLines(selections)).toHaveLength(3);

    const note = selectionNote(selections);
    expect(note).toContain(`- clip ${clipId} in timeline ${v.timeline.id}`);
    expect(note).toContain('- effect "Kinetic title" (kineticTitle):');
    expect(note).toContain('- effect "Word swap" (wordSwap):');
    expect(note).toContain('- effect "Pop captions" (popCaptions):');

    const tools = effectToolsFor(selections);
    expect(tools).toContain(GRAPHICS_DESIGN_TOOL);
    expect(tools).not.toContain('graphics.add');
    expect(tools).toContain('captions.setStyle');
    expect(tools).toContain('timeline.get');
  });

  it('pre-loads effect tools on step 0 and executes single and multiple tagged effects in an agent run', async () => {
    const selections: SelectionChip[] = [
      { kind: 'effect', effectId: 'kineticTitle' },
      { kind: 'effect', effectId: 'callToAction' },
    ];

    const jobs: GraphicsDesignJob[] = [];
    const h = harness({
      modules: [graphicsModule(jobs)],
      script: turns(
        plan('Ask the Designer for the tagged kinetic title and end CTA card'),
        {
          toolCalls: [
            call(GRAPHICS_DESIGN_TOOL, {
              request: 'A kinetic title "Wait for the drop", its words rising in with a snappy feel',
              phrase: 'wait for the drop',
            }),
            call(GRAPHICS_DESIGN_TOOL, {
              request: 'An end card "Follow for part 2" that pops in with a bounce',
              at: 8,
            }),
          ],
        },
        { text: 'The kinetic title and the closing card are on their way from the Designer.' },
      ),
    });

    const outcome = unwrap(
      await h.agent.run({
        conversationId: 'c-effects',
        message: 'Apply effects: Kinetic title, End CTA card',
        selections,
      }),
    );

    expect(outcome.status).toBe('completed');
    expect(h.applied).toEqual([]);
    expect(jobs).toHaveLength(2);
    for (const job of jobs) expect(graphicsDesignJobSchema.safeParse(job).success).toBe(true);

    const events = await h.events(outcome.runId);
    const routeChosen = events.find((e) => e.type === 'route.chosen');
    expect(routeChosen?.type === 'route.chosen' && routeChosen.payload.tools).toContain(GRAPHICS_DESIGN_TOOL);
  });

  it('covers all 19 effect ids in effectToolsFor', () => {
    const allChips: SelectionChip[] = CHAT_EFFECT_IDS.map((effectId) => ({ kind: 'effect', effectId }));
    const tools = effectToolsFor(allChips);
    expect(tools).toEqual(
      expect.arrayContaining([
        'timeline.get',
        GRAPHICS_DESIGN_TOOL,
        'timeline.setReframe',
        'timeline.planEnergyCurve',
        'captions.setStyle',
        'sfx.addHits',
      ]),
    );
  });
});
