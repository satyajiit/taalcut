// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The Analyst's work after a breakdown, as a test does it: every dispute judged, every slot written, finalised. */
import type { z } from 'zod';
import type { resolveCutsOutputSchema } from '../../src/tools/schemas';
import type { ToolSetup } from './tool-setup';

type Page = z.output<typeof resolveCutsOutputSchema>;

export interface BreakdownStart {
  readonly breakdownId: string;
  readonly next: { readonly at: number; readonly ruleKeeps: boolean } | null;
}

export interface Finalised {
  readonly templateId: string;
  readonly version: number;
  readonly media: { readonly bytes: number; readonly hasAudio: boolean } | null;
}

export async function finaliseBreakdown(
  setup: ToolSetup,
  breakdown: BreakdownStart,
  name = 'Colour blocks',
): Promise<Finalised> {
  const { breakdownId } = breakdown;
  for (let next = breakdown.next; next !== null;) {
    const verdict = { breakdownId, at: next.at, cut: next.ruleKeeps };
    next = (await setup.value<{ next: BreakdownStart['next'] }>('templates.judgeCut', verdict)).next;
  }
  const resolve = () => setup.value<Page>('templates.resolveCuts', { breakdownId });
  for (let page = await resolve(); page.slots.length > 0; page = await resolve()) {
    await setup.value('templates.setIntents', {
      breakdownId,
      intents: page.slots.map((slot) => ({
        slotIndex: slot.index,
        intent: {
          text: `shot ${slot.index}`,
          shotType: 'medium',
          motion: 'static',
          subject: null,
          people: 0,
          place: null,
          energy: 0.5,
        },
      })),
    });
  }
  return setup.value<Finalised>('templates.finalise', { projectId: setup.projectA, breakdownId, name });
}
