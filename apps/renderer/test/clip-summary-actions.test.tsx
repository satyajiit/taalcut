// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LIB1-FIND: the clip's summary says what its people are doing, in rose beside how many people there are: the fixed
// actions first, in the vocabulary's order and translated, then free ones as the model wrote them; each once across
// the clip's shots, at most eight. A clip whose shots show no one doing anything has no such row.
import { I18nProvider } from '@lingui/react';
import type { AssetDetail, ShotAnalysis } from '@taalcut/core';
import { render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { BackendProvider } from '../src/backend/backend';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { CLIP_FIXTURE } from '../src/features/library/clip/clip-fixture';
import { ClipSummary } from '../src/features/library/clip/inspector/clip-summary';
import { activateLocale, i18n } from '../src/i18n/i18n';

beforeAll(() => activateLocale('en'));

/** The fixture clip, its shots described with these actions (and people) in turn. */
function doing(shots: readonly { actions?: string[]; people?: number }[]): AssetDetail {
  return {
    ...CLIP_FIXTURE,
    stages: CLIP_FIXTURE.stages.map((stage) => ({ ...stage, state: 'done' as const })),
    shots: CLIP_FIXTURE.shots.map((shot, index) => ({
      ...shot,
      // The summary reads only a shot's description: the rest of an analysis doesn't matter here.
      analysis: {
        description: {
          text: 'A street at night',
          objects: ['street'],
          people: shots[index]?.people ?? 0,
          ...(shots[index]?.actions ? { actions: shots[index].actions } : {}),
          model: { provider: 'local', model: 'qwen3.5-4b', local: true },
        },
      } as unknown as ShotAnalysis,
    })),
  };
}

function show(detail: AssetDetail) {
  render(
    <I18nProvider i18n={i18n}>
      <BackendProvider backend={createFakeBackend().client}>
        <ClipSummary detail={detail} />
      </BackendProvider>
    </I18nProvider>,
  );
}

describe('what’s happening in a clip', () => {
  it('shows each action once, fixed words in order and translated, then free ones as written', () => {
    show(
      doing([
        { actions: ['laughing', 'kneading dough'], people: 1 },
        { actions: ['dancing', 'laughing'], people: 3 },
      ]),
    );
    const row = screen.getByRole('list', { name: 'What’s happening' });
    expect(
      within(row)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['3 people', 'Dancing', 'Laughing', 'kneading dough']);
    const free = within(row).getByText('kneading dough');
    expect(free.closest('[translate=no]')).not.toBeNull();
    expect(within(row).getByText('Dancing').closest('[translate=no]')).toBeNull();
    // The objects stay a row of their own.
    expect(within(screen.getByRole('list', { name: 'In this clip' })).getByText('street')).toBeTruthy();
  });

  it('shows at most eight', () => {
    show(
      doing([
        { actions: ['dancing', 'walking', 'running', 'jumping', 'cycling', 'swimming', 'surfing', 'hiking'] },
        { actions: ['talking', 'singing'] },
      ]),
    );
    const chips = screen.getAllByRole('listitem').filter((item) => item.dataset.slot === 'clip-action');
    expect(chips).toHaveLength(8);
    // The vocabulary's order decides which: hiking comes before talking and singing.
    expect(chips.at(-1)!.textContent).toBe('Hiking');
    expect(screen.queryByText('Talking')).toBeNull();
  });

  it('has no row when no one is doing anything', () => {
    show(doing([{}, {}]));
    expect(screen.queryByRole('list', { name: 'What’s happening' })).toBeNull();
    expect(screen.getByRole('list', { name: 'In this clip' })).toBeTruthy();
  });
});
