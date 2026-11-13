// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Phase 3 on the Make cards: the export card's AI label (P3-V7), the QA card's new checks and the Content
// Credentials refusal, the render's new stages, and the cost card's non-token billing.
import { setupI18n } from '@lingui/core';
import type { CostEstimateCardV2, QaCheckId } from '@taalcut/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { COST_V2_FIXTURES } from '../src/cards/fixtures-flow';
import { disclosureText, qaCheckLabel, qaFixLabel, renderStageLabel } from '../src/make/render-words';
import { CardView, ExportReview, MAKE_FIXTURE_IDS, MAKE_FIXTURES } from '../src/index';
import { failed, makeTimeline, ok, timelineData, wrap } from './make-fixture';

const answered = { ok: true as const, value: 'answered' as const };

const { project: PROJECT } = MAKE_FIXTURE_IDS;
const i18n = setupI18n({ locale: 'en', messages: { en: {} } });

/** Every check core names: the Record makes a new id in core a type error here until it has words. */
const QA_CHECKS: Readonly<Record<QaCheckId, true>> = {
  preflightMedia: true,
  preflightFonts: true,
  rightsReferenceAudio: true,
  container: true,
  codec: true,
  resolution: true,
  aspectRatio: true,
  frameRate: true,
  duration: true,
  bitrate: true,
  blackFrames: true,
  frozenFrames: true,
  blackBars: true,
  avSync: true,
  beatSync: true,
  loudness: true,
  silence: true,
  captionSafeZone: true,
  captionOverflow: true,
  captionGlyphs: true,
  captionReadability: true,
  subjectInFrame: true,
  cropJitter: true,
  captionCoversFace: true,
  graphicsSafeZone: true,
  graphicsOverlap: true,
  graphicsReadability: true,
  voiceOverMusic: true,
  contentCredentials: true,
  brandAssets: true,
  stylePacing: true,
  graphicCoversFace: true,
  slotNeeds: true,
  slotFace: true,
  slotFraming: true,
  slotMotion: true,
  slotTiming: true,
  slotGraphics: true,
  soundOnCuts: true,
  soundClean: true,
  soundCritique: true,
};

describe('export review: the AI label', () => {
  const card = MAKE_FIXTURES.exportApproval.credentials;
  const data = () => timelineData(makeTimeline());
  /** UX4 (B8): on the review page, behind Options. */
  const review = (reviewed: typeof card, actions: Parameters<typeof wrap>[1]) => {
    wrap(<ExportReview card={reviewed} onBack={vi.fn()} />, actions, data());
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
  };
  const toggle = () => screen.getByRole('switch', { name: 'Add Content Credentials (C2PA)' });

  it('is off, says what turning it on keeps, and reminds about each app with this one open', () => {
    review(card, { decide: vi.fn().mockResolvedValue(answered), dispatch: vi.fn() });
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/2 parts carry Content Credentials from their makers/)).toBeTruthy();
    const reminders = document.querySelector<HTMLElement>('[data-slot=disclosures]')!;
    const rows = within(reminders).getAllByRole('button');
    expect(rows.map((row) => row.getAttribute('aria-expanded'))).toEqual(['false', 'true', 'false']);
    expect(within(reminders).getByText(disclosureText(i18n, 'reels', 'steps'))).toBeTruthy();
    fireEvent.click(rows[0]!);
    expect(rows[0]!.getAttribute('aria-expanded')).toBe('true');
  });

  it('turns on with render.setContentCredentials, and goes back off when that fails', async () => {
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    review(card, { decide: vi.fn().mockResolvedValue(answered), dispatch });
    fireEvent.click(toggle());
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('render.setContentCredentials', {
        projectId: PROJECT,
        add: true,
      }),
    );
    expect(await screen.findByText(/Signed with a test certificate/)).toBeTruthy();
  });

  it('shows the cause and turns back off when saving fails', async () => {
    const dispatch = vi.fn(() => Promise.resolve(failed()));
    review(card, { decide: vi.fn().mockResolvedValue(answered), dispatch });
    fireEvent.click(toggle());
    expect(await screen.findByRole('alert')).toBeTruthy();
    await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('false'));
  });

  it('is not there on a Phase 2 card', () => {
    review(MAKE_FIXTURES.exportApproval.pending, {
      decide: vi.fn().mockResolvedValue(answered),
      dispatch: vi.fn(),
    });
    expect(screen.queryByRole('switch', { name: 'Add Content Credentials (C2PA)' })).toBeNull();
  });
});

describe('QA card: Phase 3 checks', () => {
  it('words every check and fix, and never offers Export anyway on failed credentials', () => {
    wrap(<CardView card={MAKE_FIXTURES.qaReport.phase3} />, {
      decide: vi.fn().mockResolvedValue(answered),
      dispatch: vi.fn(),
    });
    expect(screen.getByText('Quieter music under the voice')).toBeTruthy();
    expect(screen.getByText('Show the whole shot')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Export anyway' })).toBeNull();
    expect(screen.getByText(/can’t be exported anyway/)).toBeTruthy();
    expect(screen.queryByText('A check')).toBeNull();
  });

  it('has words for all of core’s checks, the new fixes and the new stages', () => {
    for (const id of Object.keys(QA_CHECKS))
      expect(qaCheckLabel(i18n, `qa.checks.${id}`)).not.toBe('A check');
    expect(qaCheckLabel(i18n, 'qa.checks.somethingNew')).toBe('A check');
    expect(qaFixLabel(i18n, 'qa.fixes.captionClearFace')).toBe('Move captions off the face');
    expect(renderStageLabel(i18n, 'render.stage.reframing')).toBe('Framing');
    expect(renderStageLabel(i18n, 'render.stage.signing')).toBe('Signing');
  });

  it('shows the signing stage on the render card', () => {
    wrap(<CardView card={MAKE_FIXTURES.renderProgress.signing} />, {
      decide: vi.fn().mockResolvedValue(answered),
      dispatch: vi.fn(),
    });
    expect(screen.getAllByText(/Signing/).length).toBeGreaterThan(0);
  });
});

describe('cost card: billed units', () => {
  it('says what a provider bills when it isn’t tokens, and “about” for an estimate', () => {
    const base = COST_V2_FIXTURES.goingAhead;
    if (base?.version !== 2) throw new Error('the going-ahead fixture is a v2 card');
    const card: CostEstimateCardV2 = {
      ...base,
      lines: [
        { ...base.lines[0]!, billed: { unit: 'image', quantity: 4 }, estimated: true },
        { ...base.lines[0]!, model: 'eleven_v3', billed: { unit: 'character', quantity: 1240 } },
      ],
    };
    wrap(<CardView card={card} />, { decide: vi.fn().mockResolvedValue(answered) });
    fireEvent.click(screen.getByRole('button', { name: 'Cost breakdown' }));
    const lines = screen.getByRole('list', { name: 'By model' });
    expect(within(lines).getByText('4 images')).toBeTruthy();
    expect(within(lines).getByText('1,240 characters')).toBeTruthy();
    expect(within(lines).getByText(/^about /)).toBeTruthy();
  });
});
