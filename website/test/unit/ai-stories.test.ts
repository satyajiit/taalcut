// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { neighbours, restTime, RUN_CAP, runSeconds, segmentAt, segmentSeconds, stepFrom, wrap } from '../../src/components/your-ai/stories/story-model';
import { AI_STORIES, CHATGPT_MOMENTS, CHATGPT_STICKERS, RING_OF, sentencesOf, STORIES, WAY_HEADERS } from '#content/ai-stories';
import { claimViolations } from '#content/claims';
import { CAMERA_ROLL } from '#content/reels';
import { YOUR_AI_SECTION } from '#content/home';
import { API_KEYS, CHATGPT, ON_DEVICE, OWN_SERVER, PROVIDER_GRID, PROVIDERS } from '#content/providers';
import { read } from './source-files';

/** Every string value in a content object, however deep. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

/** The words the stories may say: providers.ts and home.ts, as their modules hold them. */
const SOURCES = strings([PROVIDERS, API_KEYS, OWN_SERVER, ON_DEVICE, CHATGPT, YOUR_AI_SECTION]).join('\n');

describe('the stories’ words', () => {
  it('tell one story an AI, in the tray’s order, which is PROVIDERS’ order', () => {
    expect(AI_STORIES.map((s) => s.id)).toEqual(PROVIDERS.map((p) => p.id));
    expect(AI_STORIES.map((s) => s.provider.name)).toEqual(['ChatGPT', 'OpenAI', 'Anthropic', 'Google Gemini', 'OpenRouter', 'ElevenLabs', 'Taalcut’s own models', 'Ollama', 'LM Studio']);
  });

  it('say every fact word for word as providers.ts and home.ts hold it', () => {
    for (const story of AI_STORIES) {
      for (const seg of story.segments) {
        expect(SOURCES, `${story.id}: ${seg.words}`).toContain(seg.words);
        if (seg.more) expect(SOURCES, `${story.id}: ${seg.more}`).toContain(seg.more);
      }
    }
  });

  it('carry what the removed facts block said: the keys, the keychain, the budget, your own server', () => {
    const said = AI_STORIES.flatMap((s) => s.segments.flatMap((g) => [g.words, g.more ?? ''])).join(' ');
    expect(said).toContain('Paste a key in Settings › Accounts and Taalcut calls that provider for you.');
    expect(said).toContain('Taalcut keeps it encrypted with a key in your computer’s keychain, and never shows it back.');
    expect(said).toContain(API_KEYS.cap[0]);
    expect(said).toContain('You never need one: Taalcut already runs models on your computer.');
    for (const p of PROVIDERS) expect(said, p.id).toContain(p.id === 'on-device' ? 'always run here' : p.does);
  });

  it('pass the truth ledger and the hedge sweep, labels included', () => {
    const copy = strings([AI_STORIES.map((s) => s.segments), WAY_HEADERS, CHATGPT_STICKERS, STORIES.tray, STORIES.previous, STORIES.next, STORIES.replay, STORIES.chatgptLink, STORIES.paused]);
    copy.push(STORIES.status(2, 4, 'Your key'), STORIES.storyOf('OpenAI'), CHATGPT_STICKERS.stepOf(2, 'Sign in'));
    expect(copy.flatMap(claimViolations)).toEqual([]);
  });

  it('shorten only what the page says in full: the window’s two stickers', () => {
    expect(CHATGPT.facts[0]?.[1]).toContain(CHATGPT_STICKERS.password);
    expect(CHATGPT.lead).toContain(`There is ${CHATGPT_STICKERS.bill.charAt(0).toLowerCase()}${CHATGPT_STICKERS.bill.slice(1)}.`);
  });

  it('give each way its ring and its header in PROVIDER_GRID’s words', () => {
    expect(RING_OF).toEqual({ subscription: 'ai', 'api-key': 'ai', 'own-server': 'server', 'on-device': 'you' });
    for (const w of ['api-key', 'own-server', 'on-device'] as const) expect(WAY_HEADERS[w]).toBe(PROVIDER_GRID.ways[w].label);
    for (const s of AI_STORIES) expect(s.ring).toBe(RING_OF[s.provider.way]);
  });

  it('put a different shot of the owner’s roll behind every story, never one with its own captions', () => {
    const clips = AI_STORIES.map((s) => s.clip);
    expect(new Set(clips).size).toBe(clips.length);
    for (const c of clips) {
      expect(CAMERA_ROLL.clips.some((k) => k.id === c), c).toBe(true);
      // The airport reel burns in its captions, and the Vietnam reel's opening shot its chat bubbles.
      expect(c.startsWith('airport-') || c === 'vietnam-01', c).toBe(false);
    }
    // Day views from the third trip among the city nights.
    expect(clips.some((c) => c.startsWith('repeat-'))).toBe(true);
    expect(clips.some((c) => c.startsWith('vietnam-'))).toBe(true);
  });

  it('give each of the window’s steps its facts, all four once, and lead with a fact only where it says the step', () => {
    expect(CHATGPT_MOMENTS.map((m) => m.step)).toEqual(CHATGPT.steps.map((s) => s.id));
    expect(CHATGPT_MOMENTS.flatMap((m) => [...(m.lead === undefined ? [] : [m.lead]), ...m.facts]).sort()).toEqual([0, 1, 2, 3]);
    // Step 2's line and "Where you sign in" are one fact: the browser, OpenAI's own page, the password never seen.
    expect(CHATGPT.steps[1].line).toContain('Taalcut never sees your password');
    expect(CHATGPT.facts[0]?.[1]).toContain('Taalcut never sees your password');
  });

  it('split a lead into its sentences, full stops kept', () => {
    expect(sentencesOf('One thing. Another: with a › mark. Last.')).toEqual(['One thing.', 'Another: with a › mark.', 'Last.']);
  });
});

describe('the stories’ clock', () => {
  it('plays every story in under five seconds, a segment never over 1.6 s', () => {
    for (const s of AI_STORIES) {
      expect(runSeconds(s.segments.length), s.id).toBeLessThanOrEqual(RUN_CAP);
      expect(runSeconds(s.segments.length), s.id).toBeLessThan(5);
      expect(segmentSeconds(s.segments.length), s.id).toBeLessThanOrEqual(1.6);
    }
    expect(segmentSeconds(0)).toBe(0);
  });

  it('shows segment k from k to k + 1, the last once finished', () => {
    expect(segmentAt(0, 4)).toBe(0);
    expect(segmentAt(0.5, 4)).toBe(0);
    expect(segmentAt(1, 4)).toBe(0);
    expect(segmentAt(1.01, 4)).toBe(1);
    expect(segmentAt(4, 4)).toBe(3);
    expect(segmentAt(9, 4)).toBe(3);
    for (let k = 0; k < 4; k += 1) expect(segmentAt(restTime(k, 4), 4)).toBe(k);
  });

  it('flanks the open story with its neighbours, round the ends', () => {
    expect(wrap(0, -1, 9)).toBe(8);
    expect(wrap(8, 1, 9)).toBe(0);
    expect(neighbours(0, 9, 2)).toEqual({ before: [8, 7], after: [1, 2] });
    expect(neighbours(4, 9, 1)).toEqual({ before: [3], after: [5] });
    expect(neighbours(0, 3, 2)).toEqual({ before: [2], after: [1] });
  });

  it('lands Previous and Next as stories do', () => {
    const at = (a: number) => ({ at: a, count: 4, index: 1, stories: 9 });
    expect(stepFrom(at(1), 1)).toEqual({ kind: 'segment', at: 2 });
    expect(stepFrom(at(3), 1)).toEqual({ kind: 'story', index: 2, mode: 'play' });
    expect(stepFrom(at(2), -1)).toEqual({ kind: 'segment', at: 1 });
    expect(stepFrom(at(0), -1)).toEqual({ kind: 'story', index: 0, mode: 'rest' });
    expect(stepFrom({ at: 0, count: 3, index: 0, stories: 9 }, -1)).toEqual({ kind: 'story', index: 8, mode: 'rest' });
  });
});

describe('the files', () => {
  it('keep under 400 lines, with the licence header and a stamp', () => {
    for (const f of [
      'src/content/ai-stories.ts',
      'src/components/your-ai/stories/story-model.ts',
      'src/components/your-ai/stories/use-story-run.ts',
      'src/components/your-ai/stories/story-avatar.tsx',
      'src/components/your-ai/stories/story-tray.tsx',
      'src/components/your-ai/stories/story-frame.tsx',
      'src/components/your-ai/stories/story-preview.tsx',
      'src/components/your-ai/stories/stories.tsx',
      'src/components/your-ai/stories/chatgpt-window.tsx',
      'src/components/your-ai/stories/chatgpt-steps.tsx',
      'src/components/your-ai/stories/chatgpt-demo.tsx',
      'src/components/your-ai/chatgpt-section.tsx',
      'src/components/your-ai/providers-section.tsx',
      'src/components/home/your-ai.tsx',
    ]) {
      const text = read(f);
      expect(text.split('\n').length, f).toBeLessThanOrEqual(400);
      expect(text.startsWith('// SPDX-License-Identifier: AGPL-3.0-or-later\n// Copyright (C) 2026 Taalcut contributors\n'), f).toBe(true);
      if (f.endsWith('.tsx')) expect(text, f).toMatch(/(component|section): [^·]+· mode: \w+[^·]*· system: WEB2 Remix Vernacular/);
    }
  });
});
