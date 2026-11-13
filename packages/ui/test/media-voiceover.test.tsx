// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { CardOf, Clip, Id, Timeline } from '@taalcut/core';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CardView,
  type CardActions,
  type CardData,
  type MediaCardActions,
  type MediaCardData,
} from '../src/index';
import { clipId, failed, makeTimeline, ok, RATE, slotId, timelineData, wrap } from './make-fixture';

const voiceClip = (n: number) => `01K7C5M6Q8V00000000000000${n}` as Id<'TimelineItem'>;
const RUN = '01K7C5M6Q8R9S0T1V2W3X4Y5Z7' as Id<'AgentRun'>;
const BASE = makeTimeline({ slots: 3 });

/** The card: three lines on slots 1 and 3 (and one with no slot), the second off the beat. */
function card(overrides: Partial<CardOf<'voiceover'>> = {}): CardOf<'voiceover'> {
  return {
    type: 'voiceover',
    id: 'voiceover',
    version: 1,
    runId: RUN,
    projectId: BASE.projectId,
    timelineId: BASE.id,
    voiceover: {
      id: '01K7C5M6Q8R9S0T1V2W3X4MV01' as Id<'Voiceover'>,
      voiceName: 'Ana',
      own: false,
      language: 'pt-BR',
      lines: [
        line(1, 'Primeiro, o café.', slotId(1)),
        { ...line(2, 'Depois, o mercado.', slotId(3)), offBeat: true },
      ],
    },
    quality: 'draft',
    spent: { currency: 'USD', micros: 8_000 },
    finalizeEstimate: { currency: 'USD', micros: 30_000 },
    ducking: { enabled: true, minMarginLu: 9 },
    ...overrides,
  };
}

function line(
  n: number,
  text: string,
  slot: Id<'TemplateSlot'> | null,
): CardOf<'voiceover'>['voiceover']['lines'][number] {
  return {
    id: `01K7C5M6Q8R9S0T1V2W3X4MW0${n}` as Id<'VoiceLine'>,
    text,
    slotId: slot,
    clipId: voiceClip(n),
    assetId: null,
    quality: 'draft',
    duration: { value: 40, rate: RATE },
    offBeat: false,
  };
}

/** The timeline with the card's voiceover on it: line 1 at frame 0, line 2 at frame 90 (slot 3). */
function withVoiceover(timeline: Timeline, voiceover: CardOf<'voiceover'>['voiceover']): Timeline {
  const clip = (n: number): Clip => ({
    type: 'clip',
    id: voiceClip(n),
    media: {
      kind: 'audio',
      assetId: `01K7C5M6Q8W00000000000000${n}` as Id<'Asset'>,
      available: { start: { value: 0, rate: RATE }, duration: { value: 40, rate: RATE } },
    },
    sourceStart: { value: 0, rate: RATE },
    duration: { value: 40, rate: RATE },
    speed: null,
    slotId: null,
    syncPoint: null,
    beatAnchor: null,
    fit: 'cover',
    audio: { gainDb: 0, muted: false },
    locked: false,
    enabled: true,
    stillMotion: null,
    reframe: null,
  });
  const gap = { type: 'gap' as const, id: clipId(90), duration: { value: 50, rate: RATE }, slotId: null };
  return {
    ...timeline,
    tracks: [
      ...timeline.tracks,
      {
        kind: 'audio',
        id: 'A2',
        name: 'Voice',
        enabled: true,
        role: 'voice',
        items: [clip(1), gap, clip(2)],
      },
    ],
    voiceover: { ...voiceover, voiceId: 'v1', seed: 1 },
  };
}

/** CardData whose timeline can change (a command's write), like the app's watchTimeline. */
function liveData(first: Timeline | null, extra: Partial<CardData & MediaCardData> = {}) {
  let listener: ((timeline: Timeline | null) => void) | null = null;
  const data: CardData & MediaCardData = {
    ...timelineData(first),
    watchTimeline: (_id, onChange) => {
      listener = onChange;
      onChange(first);
      return () => undefined;
    },
    ...extra,
  };
  return { data, push: (next: Timeline | null) => act(() => listener?.(next)) };
}

const actionsWith = (extra: CardActions & MediaCardActions): CardActions => extra;

describe('voiceover card (U-1)', () => {
  it('shows the voice as written, its language, quality, cost, and each line with its slot, length and beat', () => {
    const current = card({ voiceover: { ...card().voiceover, voiceName: '<b>Ana</b>', own: true } });
    const { data } = liveData(withVoiceover(BASE, current.voiceover));
    wrap(<CardView card={current} />, {}, data);
    const name = screen.getByText('<b>Ana</b>');
    expect(name.getAttribute('translate')).toBe('no');
    expect(screen.getByText('Your voice')).toBeTruthy();
    expect(screen.getByText('Brazilian Portuguese')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText('$0.008 spent so far')).toBeTruthy();
    expect(screen.getByText('Line 1 · slot 1')).toBeTruthy();
    expect(screen.getByText('Line 2 · slot 3')).toBeTruthy();
    expect(screen.getAllByText('1.3s')).toHaveLength(2);
    expect(screen.getByText('Off the beat')).toBeTruthy();
    expect(screen.getByText('Depois, o mercado.').closest('[translate=no]')).toBeTruthy();
  });

  it('leaves out every control without app actions, and says when the video is gone', () => {
    const { data } = liveData(null);
    wrap(<CardView card={card()} />, {}, data);
    expect(screen.getByText('This video was deleted.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('removes the voiceover with voice.removeVoiceover and shows a settled status line without inline Undo', async () => {
    const current = card();
    const { data, push } = liveData(withVoiceover(BASE, current.voiceover));
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    const undo = vi.fn(() => Promise.resolve(ok()));
    wrap(<CardView card={current} />, { dispatch, undo }, data);
    fireEvent.click(screen.getByRole('button', { name: 'Remove voiceover' }));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('voice.removeVoiceover', {
        projectId: BASE.projectId,
        timelineId: BASE.id,
      }),
    );
    push({ ...BASE, voiceover: null, revision: BASE.revision + 1 });
    expect(await screen.findByText('Voiceover removed from this video.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('turns ducking off and moves its margin with music.setDucking, within 6 to 20 LU', async () => {
    const current = card();
    const { data } = liveData(withVoiceover(BASE, current.voiceover));
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    wrap(<CardView card={current} />, { dispatch }, data);
    expect(screen.getByText('Voice 9 LU above music')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Lower the music while the voice speaks' }));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('music.setDucking', {
        projectId: BASE.projectId,
        timelineId: BASE.id,
        ducking: { enabled: false },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bigger margin' }));
    await waitFor(() =>
      expect(dispatch).toHaveBeenLastCalledWith(
        'music.setDucking',
        expect.objectContaining({ ducking: { marginLu: 9 } }),
      ),
    );
  });

  it('keeps the switch where it was and says why when the change fails', async () => {
    const current = card();
    const { data } = liveData(withVoiceover(BASE, current.voiceover));
    wrap(<CardView card={current} />, { dispatch: () => Promise.resolve(failed('core.conflict')) }, data);
    const toggle = screen.getByRole('switch', { name: 'Lower the music while the voice speaks' });
    fireEvent.click(toggle);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.getAttribute('aria-invalid')).toBe('true');
  });

  it('sends Change voice, Make final and an edited line to the run as follow-ups (they cost money)', async () => {
    const current = card();
    const { data } = liveData(withVoiceover(BASE, current.voiceover));
    const followUp = vi.fn<NonNullable<MediaCardActions['followUp']>>(() => Promise.resolve(ok()));
    wrap(<CardView card={current} />, actionsWith({ followUp }), data);
    fireEvent.click(screen.getByRole('button', { name: 'Change voice' }));
    await waitFor(() =>
      expect(followUp).toHaveBeenCalledWith(RUN, 'Try a different voice for the voiceover.', []),
    );
    expect(await screen.findByText(/Sent to the chat/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make final · about $0.03' }));
    await waitFor(() => expect(followUp).toHaveBeenLastCalledWith(RUN, 'Make the voiceover final.', []));

    fireEvent.click(screen.getByRole('button', { name: 'Edit line 2' }));
    const field = screen.getByLabelText('New words for line 2');
    expect(screen.getByRole('button', { name: 'Send change' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(field, { target: { value: 'Depois, a feira acorda.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send change' }));
    await waitFor(() =>
      expect(followUp).toHaveBeenLastCalledWith(
        RUN,
        'Change line 2 of the voiceover to: “Depois, a feira acorda.”',
        [{ kind: 'clip', timelineId: BASE.id, clipId: voiceClip(2) }],
      ),
    );
    await waitFor(() => expect(screen.queryByLabelText('New words for line 2')).toBeNull());
  });

  it('puts the words in the composer when the app can only ask', async () => {
    const ask = vi.fn();
    wrap(<CardView card={card({ runId: undefined })} />, { ask });
    fireEvent.click(screen.getByRole('button', { name: 'Change voice' }));
    expect(ask).toHaveBeenCalledWith('Try a different voice for the voiceover.', []);
    expect(await screen.findByText(/It’s in the message box/)).toBeTruthy();
  });

  it('plays a line from its place when the preview can, and hides Make final once final', () => {
    const current = card({ quality: 'final', finalizeEstimate: null });
    const final = {
      ...current.voiceover,
      lines: current.voiceover.lines.map((each) => ({ ...each, quality: 'final' as const })),
    };
    const renderPreviewFrom = vi.fn<NonNullable<MediaCardData['renderPreviewFrom']>>(() => null);
    const { data } = liveData(withVoiceover(BASE, final), { renderPreviewFrom });
    wrap(
      <CardView card={{ ...current, voiceover: final }} />,
      actionsWith({ followUp: () => Promise.resolve(ok()) }),
      data,
    );
    expect(screen.queryByRole('button', { name: /Make final/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Play line 2' }));
    expect(renderPreviewFrom).toHaveBeenLastCalledWith(
      expect.objectContaining({ timelineId: BASE.id, playFrom: { frame: 90, key: 1 } }),
    );
  });

  it('says so when the timeline has no voiceover now, without offering its controls', () => {
    const { data } = liveData(BASE);
    wrap(<CardView card={card()} />, { dispatch: () => Promise.resolve(ok()) }, data);
    expect(screen.getByText('This video has no voiceover now.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove voiceover' })).toBeNull();
  });
});
