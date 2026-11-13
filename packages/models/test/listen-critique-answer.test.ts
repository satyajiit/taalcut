// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-X1: the parts of `audio.cloudCritique` that are earshot's `llm.py` (build_prompt, context, parse_json,
 * normalize), with no model: the prompt it builds, what it says about this Mac's measurements, and how a loose
 * answer becomes a predictable critique in file time.
 */
import { describe, expect, it } from 'vitest';
import {
  err,
  FrameRate,
  ok,
  RationalTime,
  type AssetId,
  type SoundEvent,
  type SoundSection,
} from '@taalcut/core';
import {
  buildCritiquePrompt,
  createCloudCritiqueTool,
  critiqueContext,
  normaliseCritique,
  parseAnswerJson,
  secondsOf,
  type ModelClient,
  type ModelResult,
} from '@taalcut/models';
import { critiqueDeps, MEASURES, toolContext } from './support/listen-critique';

const ASSET = '01JD0000000000000000000000' as AssetId;
const ms = (n: number) => RationalTime.of(n, FrameRate.of(1000, 1));
const seconds = (t: RationalTime | null) => (t ? RationalTime.toSeconds(t) : null);

describe('the prompt (earshot build_prompt)', () => {
  it('asks for the answer field and the question only when there is one, and states synthesized intent', () => {
    const plain = buildCritiquePrompt({ context: 'Clip under review: 3.0 s' });
    expect(plain).toMatch(
      /"top_fixes": \["<most important first, at most 5>"\]}\n\nContext:\nClip under review/,
    );
    expect(plain).not.toContain('"answer"');
    expect(plain).not.toContain('Intent:');
    const asked = buildCritiquePrompt({ context: 'ctx', question: 'Is the hit late?', synthIntended: true });
    expect(asked).toContain(`,\n "answer": "<direct answer to the editor's question>"}`);
    expect(asked).toMatch(/ctx\nIntent: this film uses synthesized \/ procedural sound on purpose\./);
    expect(asked.endsWith('still fill the rest):\nIs the hit late?')).toBe(true);
  });
});

describe('the context (earshot context)', () => {
  const window = { startS: 10, endS: 40, fileSeconds: 75.04, codec: 'aac mono 64 kbps' };

  it('says what is sent and the measured loudness, never a path', () => {
    const text = critiqueContext(window, {
      measures: {
        ...MEASURES,
        lraLu: 5.42,
        crestLu: 3.1,
        tempo: { bpm: 120, alt: null, clarity: 0.5, confidence: 'clear' },
        key: { tonic: 'Eb', mode: 'minor', confidence: 0.7 },
      },
      notes: [],
    });
    expect(text.split('\n')).toEqual([
      'Clip under review: 30.0 s (file seconds 10.0-40.0 of a 75.0 s file), sent as aac mono 64 kbps for this review.',
      'Measured by Taalcut on this Mac (exact; use these, never estimate loudness): integrated loudness -14.2 LUFS, ' +
        'true peak -1.3 dBTP, loudness range 5.42 LU, short-term max -11.1 LUFS, quietest 20 ms level (10th ' +
        'percentile) -48.5 dBFS.',
      'Music grid: tempo 120 BPM (clear pulse), key Eb minor.',
    ]);
  });

  it('adds the listening summary in file seconds with withTimeline', () => {
    const event = {
      at: ms(1500),
      shape: 'hit',
      band: 'full',
      contrastDb: 20,
      prominenceDb: 14.25,
      bedDb: -40,
      peakDbfs: -3,
      lengthMs: 120,
      kind: 'whoosh',
      exposed: true,
    } as SoundEvent;
    const section = { start: ms(0), end: ms(8000), label: 'cinematic music, strings' } as SoundSection;
    const text = critiqueContext(window, {
      measures: null,
      timeline: { events: [event], sections: [section] },
      notes: [],
    });
    expect(text).toContain(
      'Taalcut listening transcript (machine-made; file times, clip starts at file second 10.0):',
    );
    expect(text).toContain('section 10.0-18.0 s: cinematic music, strings');
    expect(text).toContain('hit whoosh at 11.50 s, 14.25 dB over its bed (exposed)');
    expect(text).not.toContain('Measured by');
  });
});

describe('the answer (earshot parse_json and normalize)', () => {
  it('finds the object in fences, prose and trailing commas, and gives up on anything else', () => {
    expect(parseAnswerJson('```json\n{"overall": {"score": 7,},}\n```')).toEqual({ overall: { score: 7 } });
    expect(parseAnswerJson('Here it is: {"a": "}{", "b": [1,2,],} hope that helps')).toEqual({
      a: '}{',
      b: [1, 2],
    });
    expect(parseAnswerJson('no json at all')).toBeUndefined();
    expect(parseAnswerJson('[1, 2]')).toBeUndefined();
  });

  it('reads seconds the way a model writes them', () => {
    expect([
      secondsOf(12.4),
      secondsOf('12.4'),
      secondsOf('12.4s'),
      secondsOf('1:02.5'),
      secondsOf('soon'),
    ]).toEqual([12.4, 12.4, 12.4, 62.5, undefined]);
  });

  it('clamps scores and times to the clip, moves them to file time, and sorts issues by severity then time', () => {
    const critique = normaliseCritique(
      {
        overall: '8.5',
        scores: { sync: '7/10', realism: 12, mix_balance: -3, loudness: null, music: 'n/a' },
        notes: { sync: ' tight ', music: '' },
        issues: [
          { start: 5, end: 3, severity: 'LOW', category: 'mix', problem: 'p1', fix: 'f1' },
          { start: '0:02', end: 99, severity: 'urgent', category: 'sync', problem: 'p2', fix: 'f2' },
          { start: 1, severity: 'high', problem: 'p3' },
          { severity: 'high', problem: 'untimed' },
          'not an issue',
        ],
        synthetic_or_cheap: [{ start: 50, what: 'beep' }],
        strengths: ['', 'tight edit', 3],
        top_fixes: ['a', 'b', 'c', 'd', 'e', 'f'],
        answer: '  Yes, 80 ms late. ',
      },
      { startS: 10, seconds: 30 },
    );
    expect(critique.overall).toEqual({ score: 8.5, verdict: '' });
    expect(critique.scores).toEqual({ sync: 7, realism: 10, mixBalance: 0, loudness: null, music: null });
    expect(critique.notes).toEqual({ sync: 'tight' });
    expect(critique.issues.map((i) => [i.problem, i.severity, seconds(i.start), seconds(i.end)])).toEqual([
      ['p3', 'high', 11, 11],
      ['untimed', 'high', null, null],
      ['p2', 'medium', 12, 40],
      ['p1', 'low', 15, 15],
    ]);
    expect(critique.syntheticOrCheap.map((s) => [seconds(s.start), seconds(s.end), s.why])).toEqual([
      [40, 40, ''],
    ]);
    expect(critique.strengths).toEqual(['tight edit', '3']);
    expect(critique.topFixes).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(critique.answer).toBe('Yes, 80 ms late.');
  });

  it('keeps the start of an answer that is not JSON, and says so', async () => {
    const reply = 'I think the mix is fine overall.';
    const models: ModelClient = {
      complete: async () =>
        ok({
          provider: 'google',
          model: 'gemini-3.5-flash',
          text: reply,
          stopReason: 'stop',
          usage: {
            inputTokens: 900,
            outputTokens: 9,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 909,
            costUsd: 0.001,
          },
        } as ModelResult),
      stream: () => {
        throw new Error('not streamed');
      },
    };
    const { deps } = critiqueDeps({ models });
    const result = await createCloudCritiqueTool(deps).run({ assetId: ASSET }, toolContext().ctx);
    expect(result).toMatchObject({ ok: true, value: { critique: null, raw: reply } });
    expect(result.ok && result.value.summary).toMatch(/answered, but not in JSON \(stop: stop\)/);
  });

  it('sends the measurements without a listening summary when this Mac could not make one', async () => {
    const seen: string[] = [];
    const models: ModelClient = {
      complete: async (request) => {
        const first = request.messages[0];
        const parts = first?.role === 'user' && Array.isArray(first.content) ? first.content : [];
        seen.push(parts.map((part) => (part.type === 'text' ? part.text : `<${part.mimeType}>`)).join('\n'));
        return err({ code: 'models.provider_unavailable', messageKey: 'x', retryable: true });
      },
      stream: () => {
        throw new Error('not streamed');
      },
    };
    const { deps, watch } = critiqueDeps({ models });
    const result = await createCloudCritiqueTool(deps).run(
      { assetId: ASSET, withTimeline: true },
      toolContext().ctx,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'models.provider_unavailable' } });
    expect(watch.facts).toEqual([{ timeline: true }]);
    expect(seen[0]).toMatch(/^<audio\/wav>\nYou are a senior re-recording mixer/);
    expect(seen[0]).toContain('integrated loudness -14.2 LUFS');
    expect(seen[0]).not.toContain('listening transcript');
  });
});
