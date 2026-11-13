// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT1: an intent naming the reel's specifics is rewritten to fit anyone's footage, not refused. The lines are the
 * kinds the local models wrote on a travel reel, with made-up places.
 */
import { describe, expect, it } from 'vitest';
import { generaliseIntent, generaliseText } from '../src/breakdown/transferable-repair';
import { reelSpecifics } from '../src/breakdown/transferable';

const line = (text: string) => generaliseText(text, false).text;

describe('rewriting the reel’s specifics', () => {
  it('turns a listed landmark or object into its general word, once', () => {
    expect(line('A person stands looking at a traditional temple and pagoda during the day.')).toBe(
      'A person stands looking at a traditional landmark during the day.',
    );
    expect(line('A person walks along a train platform at night as the camera tracks behind them.')).toBe(
      'A person walks along a transit platform at night as the camera tracks behind them.',
    );
    expect(line('Open on a person waiting as a red train arrives')).toBe(
      'Open on a person waiting as a red vehicle arrives',
    );
    expect(line('Man walks through a tunnel of red torii gates, camera tracking from behind.')).toBe(
      'Man walks through a tunnel of red gates, camera tracking from behind.',
    );
  });

  it('keeps the kind of place a name ends with, and drops other names', () => {
    expect(line('A crowd crosses at Verenta Crossing at night, wide shot.')).toBe(
      'A crowd crosses at a crossing at night, wide shot.',
    );
    expect(line('Track behind the traveler towards the Marisol Tower at night.')).toBe(
      'Track behind the traveler towards the landmark at night.',
    );
    expect(line('Man walks through a gateway with Brindlish characters, camera tracking.')).toBe(
      'Man walks through a gateway with characters, camera tracking.',
    );
    expect(line('A traveler arrives in Verenta at dusk, slow push-in.')).toBe(
      'A traveler arrives at dusk, slow push-in.',
    );
    expect(line("A sign reading 'OPEN LATE' glows over a door, close shot.")).toBe(
      'A sign glows over a door, close shot.',
    );
  });

  it('drops a name of several words and an overlay’s words written out, with their own punctuation (AGT1 x2)', () => {
    expect(line("Chat hook: How's Verenta? text pops in")).toBe('Chat hook: text pops in');
    expect(line('Text card: Welcome to Verenta appears over a street, static.')).toBe(
      'Text card: appears over a street, static.',
    );
    expect(line('A person walks toward the Temple of the Golden Hall at day.')).toBe(
      'A person walks toward the landmark at day.',
    );
    expect(line('A person walks toward the Golden Hall at day.')).toBe('A person walks at day.');
    expect(line('A person lights the Brindlish lanterns at night.')).toBe(
      'A person lights the lanterns at night.',
    );
    // AGT1 y1: a listed word written with a capital is still the listed word, and a name dropped can leave another.
    expect(line('Man walks under red Torii gates into daylight.')).toBe(
      'Man walks under red gates into daylight.',
    );
    expect(generaliseText('tunnel of red Torii gates', true).text).toBe('tunnel of red gates');
    expect(line('A traveler arrives at Marisol Tower at dusk.')).toBe(
      'A traveler arrives at a landmark at dusk.',
    );
    expect(line("Title card: How's Verenta? Well.")).toBe('Title card.');
    expect(line("Text cards asking How's Verenta? and Well.")).toBe('Text cards asking.');
    const card = generaliseIntent(
      { text: "Title card: How's Verenta? Well.", subject: null, place: null },
      2,
    );
    expect(card?.refused).toBe(false);
  });

  it('leaves nothing of the reel and says when a name went without a general word', () => {
    const generalised = generaliseIntent({
      text: 'A person walks along a train platform in Verenta at night.',
      subject: 'a person walking along a train',
      place: 'Verenta Station',
    });
    expect(generalised?.refused).toBe(false);
    expect(generalised?.dropped).toBe(true);
    expect(generalised?.intent).toEqual({
      text: 'A person walks along a transit platform at night.',
      subject: 'a person walking along a vehicle',
      place: 'a station',
    });
    for (const [index, value] of Object.values(generalised!.intent).entries())
      expect(reelSpecifics(value ?? '', index > 0)).toEqual([]);
    expect(generalised?.rewrites.map((r) => r.field)).toEqual(['text', 'subject', 'place']);
  });

  it('swaps a listed word without asking the review, and refuses a line that says too little once rewritten', () => {
    expect(
      generaliseIntent({ text: 'Frame them before a pagoda, wide.', subject: null, place: null }),
    ).toMatchObject({
      dropped: false,
      refused: false,
      intent: { text: 'Frame them before a landmark, wide.' },
    });
    expect(generaliseIntent({ text: 'Marisol Tower.', subject: null, place: null })?.refused).toBe(true);
    expect(
      generaliseIntent({ text: 'a wide shot of a beach', subject: 'traveler', place: null }),
    ).toBeUndefined();
  });

  it('generalises needs phrases and strips incidental background needs', () => {
    const generalised = generaliseIntent({
      text: 'A person checks their phone on a platform, mid shot.',
      subject: 'person',
      place: 'station',
      needs: [
        'looking at a phone',
        'vehicle approaching in background',
        'train passing by',
        'cars behind the subject',
        'eating ramen',
      ],
    });
    expect(generalised?.refused).toBe(false);
    expect(generalised?.intent.needs).toEqual(['looking at a phone', 'eating food']);
  });
});
