// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/** UX4 (B8): the chat's export card is a summary that leads to the review page (make-export.test.tsx tests the page). */
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CardView, MAKE_FIXTURES } from '../src/index';
import { makeTimeline, timelineData, wrap } from './make-fixture';

describe('export approval: the chat’s summary card', () => {
  const card = MAKE_FIXTURES.exportApproval.pending;

  it('says which video and what the check found, and hands the card to its review page', () => {
    const review = vi.fn();
    wrap(<CardView card={card} />, { decide: vi.fn(), review }, timelineData(makeTimeline()));
    expect(screen.getByText('Video 1 of 3')).toBeTruthy();
    // Nothing on the card decides: one way to the page where you do.
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review and export' }));
    expect(review).toHaveBeenCalledWith(card);
  });

  it.each([
    ['exported', 'Exported'],
    ['declined', 'Not exported. Say when you’re ready.'],
    ['expired', 'This run ended.'],
  ] as const)('says how it settled when %s, with no way to review', (status, words) => {
    wrap(
      <CardView card={MAKE_FIXTURES.exportApproval[status]} />,
      { decide: vi.fn(), review: vi.fn() },
      timelineData(makeTimeline()),
    );
    expect(screen.getByText(words)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Review and export' })).toBeNull();
  });
});
