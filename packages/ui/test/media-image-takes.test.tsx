// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { CardOf, Id, Timeline } from '@taalcut/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CardView, type CardActions, type MediaCardActions } from '../src/index';
import {
  assetId,
  clipId,
  failed,
  makeTimeline,
  ok,
  slotId,
  TEMPLATE,
  timelineData,
  wrap,
} from './make-fixture';

const RUN = '01K7C5M6Q8R9S0T1V2W3X4Y5Z7' as Id<'AgentRun'>;
const BASE = makeTimeline({ slots: 3 });
const [TAKE_A, TAKE_B] = [assetId(901), assetId(902)];

function card(overrides: Partial<CardOf<'imageTakes'>> = {}): CardOf<'imageTakes'> {
  return {
    type: 'imageTakes',
    id: 'takes',
    version: 1,
    runId: RUN,
    projectId: BASE.projectId,
    timelineId: BASE.id,
    slotId: slotId(2),
    takes: [
      { assetId: TAKE_A, provider: 'google', model: 'imagen-4', thumbnailArtifactId: 'artifact-1' },
      {
        assetId: TAKE_B,
        provider: 'openrouter',
        model: '<b>flux-2-pro</b>',
        thumbnailArtifactId: 'artifact-2',
      },
    ],
    placed: TAKE_A,
    spent: { currency: 'USD', micros: 80_000 },
    ...overrides,
  };
}

/** Slot 2 as a still of `asset`, or a gap. */
function withSlot(timeline: Timeline, asset: Id<'Asset'> | null): Timeline {
  const [video, ...rest] = timeline.tracks;
  if (video?.kind !== 'video') return timeline;
  const items = video.items.map((item) => {
    if (item.type !== 'clip' || item.slotId !== slotId(2)) return item;
    return asset
      ? { ...item, media: { kind: 'image' as const, assetId: asset }, stillMotion: 'pushIn' as const }
      : { type: 'gap' as const, id: item.id, duration: item.duration, slotId: item.slotId };
  });
  return { ...timeline, tracks: [{ ...video, items }, ...rest] };
}

const actions = (extra: CardActions & MediaCardActions): CardActions => extra;
const take = (n: number) => {
  const found = document.querySelectorAll<HTMLElement>('[data-slot=take]')[n];
  if (!found) throw new Error(`no take ${n}`);
  return found;
};

describe('image takes card (U-6)', () => {
  it('shows the slot, each take with who made it as written, which is in the video and the cost', () => {
    wrap(<CardView card={card()} />, {}, timelineData(withSlot(BASE, TAKE_A)));
    expect(screen.getByRole('heading', { name: 'Images for slot 2' })).toBeTruthy();
    expect(screen.getByText('Generated')).toBeTruthy();
    expect(screen.getByText('2 takes · $0.08 so far')).toBeTruthy();
    expect(screen.getByText('In your video')).toBeTruthy();
    expect(screen.getByText('Google').getAttribute('translate')).toBe('no');
    expect(screen.getByText('<b>flux-2-pro</b>').getAttribute('translate')).toBe('no');
    expect(take(0).getAttribute('aria-pressed')).toBe('true');
    // Named in the app's words, described by who made it as written.
    expect(
      screen.getByRole('button', { name: 'Take 2', description: 'OpenRouter <b>flux-2-pro</b>' }),
    ).toBeTruthy();
  });

  it('puts another take in with timeline.swapClip while the slot holds a clip', async () => {
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    wrap(<CardView card={card()} />, { dispatch }, timelineData(withSlot(BASE, TAKE_A)));
    fireEvent.click(take(1));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('timeline.swapClip', {
        projectId: BASE.projectId,
        timelineId: BASE.id,
        clipId: clipId(2),
        media: { assetId: TAKE_B, shotId: null },
        from: 'alternate',
      }),
    );
    expect(await screen.findByText('Image changed.')).toBeTruthy();
  });

  it('fills the slot with timeline.fillGap while it is still a gap', async () => {
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    wrap(<CardView card={card({ placed: null })} />, { dispatch }, timelineData(withSlot(BASE, null)));
    expect(screen.queryByText('In your video')).toBeNull();
    fireEvent.click(take(0));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('timeline.fillGap', {
        projectId: BASE.projectId,
        timelineId: BASE.id,
        gapId: clipId(2),
        media: { kind: 'image', assetId: TAKE_A },
      }),
    );
  });

  it('says why a pick failed', async () => {
    wrap(
      <CardView card={card()} />,
      { dispatch: () => Promise.resolve(failed('core.conflict')) },
      timelineData(withSlot(BASE, TAKE_A)),
    );
    fireEvent.click(take(1));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('sends Make more to the run (paid), with the slot as a chip', async () => {
    const followUp = vi.fn<NonNullable<MediaCardActions['followUp']>>(() => Promise.resolve(ok()));
    wrap(
      <CardView card={card({ placed: null })} />,
      actions({ followUp }),
      timelineData(withSlot(BASE, null)),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Make more' }));
    await waitFor(() =>
      expect(followUp).toHaveBeenCalledWith(RUN, 'Make more images for slot 2.', [
        { kind: 'slot', templateId: TEMPLATE, slotId: slotId(2) },
      ]),
    );
  });

  it('shows the takes but lets none be picked when the slot is not in the video now', () => {
    wrap(
      <CardView card={card({ slotId: slotId(9) })} />,
      { dispatch: () => Promise.resolve(ok()) },
      timelineData(BASE),
    );
    expect(screen.getByText('This slot isn’t in the video now.')).toBeTruthy();
    expect(take(1).hasAttribute('disabled')).toBe(true);
  });
});
