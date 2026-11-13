// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { unwrap, ValidationError, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { transcriptPlainText } from '../../src/index';
import { profileSetup, transcriptOf } from './profile-helpers';

describe('TranscriptRepository (P2-L1)', () => {
  it('stores word timings and plain text, and pages segments', () => {
    const { repos, asset, db } = profileSetup();
    const id = asset();
    const transcript = transcriptOf('hi', [
      ['नमस्ते दोस्तों', 0, 1000],
      ['समुद्र तट पर सूर्यास्त', 1000, 2000],
      ['बहुत सुंदर', 3000, 800],
    ]);
    unwrap(repos.transcripts.put(id, transcript, 3));
    expect(repos.transcripts.get(id)).toEqual(transcript);
    const row = db.driver.prepare('SELECT language, engine, local, text, generation FROM transcripts').get();
    expect(row).toEqual({
      language: 'hi',
      engine: 'parakeet',
      local: 1,
      text: transcriptPlainText(transcript),
      generation: 3,
    });
    expect(transcriptPlainText(transcript).split('\n')).toHaveLength(3);
    const first = repos.transcripts.page(id, 0, 2)!;
    expect(first.segments.map((s) => s.text)).toEqual(['नमस्ते दोस्तों', 'समुद्र तट पर सूर्यास्त']);
    expect(first.nextSegment).toBe(2);
    expect(repos.transcripts.page(id, 2, 2)).toMatchObject({
      language: 'hi',
      segments: [{ text: 'बहुत सुंदर' }],
    });
    expect(repos.transcripts.page(id, 2, 2)?.nextSegment).toBeUndefined();
  });

  it('replaces, clears and refuses', () => {
    const { repos, asset } = profileSetup();
    const id = asset();
    unwrap(repos.transcripts.put(id, transcriptOf('en', [['one', 0, 500]]), 0));
    unwrap(repos.transcripts.put(id, transcriptOf('es', [['hola amigos', 0, 900]]), 1));
    expect(repos.transcripts.get(id)?.language).toBe('es');
    unwrap(repos.transcripts.put(id, null, 2));
    expect(repos.transcripts.get(id)).toBeNull();
    expect(repos.transcripts.page(id, 0, 10)).toBeNull();
    const bad = repos.transcripts.put(id, { ...transcriptOf('en', []), engine: 'nope' as never }, 0);
    expect(!bad.ok && ValidationError.is(bad.error)).toBe(true);
    expect(repos.transcripts.put(id, null, -1).ok).toBe(false);
    expect(repos.transcripts.put('gone' as AssetId, transcriptOf('en', [['x', 0, 10]]), 0).ok).toBe(false);
  });

  it('goes with its asset', () => {
    const { repos, asset } = profileSetup();
    const id = asset();
    unwrap(repos.transcripts.put(id, transcriptOf('pt-BR', [['pôr do sol na praia', 0, 1200]]), 0));
    unwrap(repos.assets.remove(id));
    expect(repos.transcripts.get(id)).toBeNull();
  });
});
