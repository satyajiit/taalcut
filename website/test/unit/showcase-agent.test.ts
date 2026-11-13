// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { claimViolations } from '#content/claims';
import { AgentStage } from '#components/showcase/agent/agent-showcase';
import { AgentFragment } from '#components/showcase/agent/fragment';
import {
  CHANGES,
  CHECKS,
  OUTRO_WORDS,
  REEL,
  STEPS,
  WORKING_WORDS,
} from '#components/showcase/agent/run-script';
import { AgentFragment as FromIndex } from '#components/showcase/fragments';
import { SHOWCASE_HINTS } from '#components/showcase/hints';

describe('the agent showcase’s server HTML', () => {
  const html = renderToStaticMarkup(h(AgentStage));

  it('is the finished run: every step done, every shot checked on the strip and on the reel, no skeletons', () => {
    expect(html).toContain('data-showcase="agent"');
    expect(html.match(/data-step-status="done"/g)).toHaveLength(STEPS.length);
    expect(html.match(/data-slot-state="checked"/g)).toHaveLength(REEL.slots.length);
    expect(html.match(/data-reel-tick="checked"/g)).toHaveLength(REEL.slots.length);
    expect(html.match(/data-passed="true"/g)).toHaveLength(CHECKS.length);
    expect(html).toContain(OUTRO_WORDS);
    expect(html).not.toContain(WORKING_WORDS);
    expect(html).not.toContain('data-ghost');
    expect(html).not.toMatch(/opacity:\s*0[;"]/);
  });

  it('shows what changed as clips before and after, the approval waiting, and how hard it thinks in the chat box', () => {
    expect(html.match(/data-change="/g)).toHaveLength(CHANGES.length);
    expect(html).toMatch(/data-slot="approval"[^>]*data-status="waiting"/);
    expect(html).toContain(`Checked: ${CHECKS.length} of ${CHECKS.length} passed`);
    expect(html).toContain('Review and export');
    expect(html).toContain('How hard it thinks');
    expect(html).not.toContain('Thinking:');
    // The reel shows the saved reel; Your version waits for the review.
    expect(html).toMatch(/data-view="saved" aria-pressed="true"/);
    expect(html).toMatch(/data-view="yours" aria-pressed="false" aria-disabled="true"/);
  });

  it('keeps its words on the ledger', () => {
    const words = [
      STEPS.map((s) => [s.text, s.found]),
      CHECKS.map((c) => c.name),
      CHANGES.map((c) => [c.target, c.what, c.needs ?? '']),
      SHOWCASE_HINTS.agent?.title ?? '',
      SHOWCASE_HINTS.agent?.hint ?? '',
    ].flat(2);
    expect(words.map(String).flatMap(claimViolations)).toEqual([]);
  });
});

describe('the agent’s index fragment', () => {
  it('lives in agent/ and the index takes it from there; the run is finished in its HTML', () => {
    expect(FromIndex).toBe(AgentFragment);
    const html = renderToStaticMarkup(h(AgentFragment));
    expect(html).toContain('data-showcase="agent-fragment"');
    expect(html.match(/data-slot-state="checked"/g)).toHaveLength(REEL.slots.length);
    expect(html).toContain('Play the run');
    expect(html).not.toMatch(/opacity:\s*0[;"]/);
  });
});
