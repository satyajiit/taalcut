// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-GFX, HFW1: a proposed graphic's row. Use it calls its `onUse` (graphics.useProposal where it is shown); Try
 * again goes to the run as a follow-up with the graphic as a chip; Change… puts words and the chip in the composer,
 * unsent. A proposal is always a design of its own: there is no ready-made one to explain.
 */
import type { RunId, SelectionChip, TimelineId, TimelineItemId } from '@taalcut/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GraphicProposalRow, useProposalChat } from '../src/media/graphic-proposal';
import { ok, wrap } from './make-fixture';

const RUN = '01K7C5M6Q8R9S0T1V2W3X4RUN1' as RunId;
const chip: SelectionChip = {
  kind: 'item',
  timelineId: '01K7C5M6Q8R9S0T1V2W3X4TML1' as TimelineId,
  itemId: '01K7C5M6Q8R9S0T1V2W3X4ITM1' as TimelineItemId,
  itemKind: 'graphic',
};
const designed = { request: 'a made-up name card', design: 'designed', createdAt: 1 } as const;

function Proposed({ onUse }: { onUse: () => void }) {
  const chat = useProposalChat(RUN, chip);
  return (
    <GraphicProposalRow
      proposal={designed}
      disabled={false}
      using={false}
      useError={null}
      onUse={onUse}
      {...chat}
    />
  );
}

describe('a proposed graphic’s row (EDT1-GFX)', () => {
  it('says it isn’t in the video yet, and Use it puts it there', () => {
    const onUse = vi.fn();
    wrap(<Proposed onUse={onUse} />);
    expect(screen.getByText('Proposed: it plays in the viewer and isn’t in your video yet.')).toBeTruthy();
    expect(screen.queryByText(/Taalcut’s own design/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use it' }));
    expect(onUse).toHaveBeenCalledOnce();
  });

  it('Try again asks the run for another design; Change… puts words and the graphic in the composer', async () => {
    const followUp = vi.fn(() => Promise.resolve(ok()));
    const ask = vi.fn();
    wrap(<Proposed onUse={() => undefined} />, { followUp, ask });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(followUp).toHaveBeenCalledWith(RUN, 'Try again: design this graphic another way.', [chip]),
    );
    expect(await screen.findByText('Asked for another design.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change…' }));
    expect(ask).toHaveBeenCalledWith('Change this graphic: ', [chip]);
  });
});
