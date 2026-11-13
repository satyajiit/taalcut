// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LIB1-FIND: the describing model recorded from Ollama, and replayed from the recording. */
import type { BackgroundModelRequest } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { promptId, recordingModels, replayingModels } from '../../../src/search/find/models';
import { recordingFileSchema } from '../../../src/search/find/schema';

const request = (text: string, image = 'AAAA', system = 'You describe frames.'): BackgroundModelRequest => ({
  module: 'vision',
  placement: 'local',
  system,
  content: [
    { type: 'text', text },
    { type: 'image', data: image, mimeType: 'image/jpeg' },
  ],
  maxTokens: 400,
  temperature: 0,
  reasoning: 'off',
});

function ollama(answers: string[]) {
  const bodies: unknown[] = [];
  const fake = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ message: { role: 'assistant', content: answers.shift() } }));
  }) as typeof fetch;
  return { fake, bodies };
}

describe('recordingModels', () => {
  it('asks Ollama with the frame and the request, thinking off, and records each answer by clip and turn', async () => {
    const { fake, bodies } = ollama(['{"description":"a"}', '{"description":"b"}']);
    const models = recordingModels({ baseUrl: 'http://127.0.0.1:11434/', model: 'qwen3.5:4b', fetch: fake });
    models.forClip('dance-rabha');
    const first = await models.complete(request('Describe this frame as JSON.'));
    expect(first.ok && first.value.status === 'answered' && first.value.text).toBe('{"description":"a"}');
    models.forClip('halong-bay');
    await models.complete(request('Describe this frame as JSON.', 'BBBB'));
    expect(bodies[0]).toMatchObject({
      model: 'qwen3.5:4b',
      stream: false,
      think: false,
      options: { temperature: 0, num_predict: 400 },
      messages: [
        { role: 'system' },
        { role: 'user', content: 'Describe this frame as JSON.', images: ['AAAA'] },
      ],
    });
    const file = models.recording(new Date('2026-10-29T10:00:00Z'));
    expect(recordingFileSchema.safeParse(file).success).toBe(true);
    expect(file.prompt).toBe(promptId('You describe frames.'));
    expect(file.answers.map((a) => [a.clip, a.n, a.answer])).toEqual([
      ['dance-rabha', 0, '{"description":"a"}'],
      ['halong-bay', 0, '{"description":"b"}'],
    ]);
  });

  it('fails when Ollama does, or when the system prompt changes mid-recording', async () => {
    const down = (async () => new Response('no', { status: 500 })) as typeof fetch;
    const failing = recordingModels({ baseUrl: 'http://x', model: 'm', fetch: down });
    expect((await failing.complete(request('x'))).ok).toBe(false);
    const { fake } = ollama(['{}', '{}']);
    const models = recordingModels({ baseUrl: 'http://x', model: 'm', fetch: fake });
    await models.complete(request('x'));
    expect((await models.complete(request('x', 'AAAA', 'Another prompt.'))).ok).toBe(false);
  });
});

describe('replayingModels', () => {
  async function recorded() {
    const { fake } = ollama(['one', 'two']);
    const models = recordingModels({ baseUrl: 'http://x', model: 'qwen3.5:4b', fetch: fake });
    models.forClip('c');
    await models.complete(request('first'));
    await models.complete(request('second'));
    return models.recording(new Date());
  }

  it('answers request n of a clip with its answer n, and counts what differs from the recording', async () => {
    const replay = replayingModels(await recorded());
    replay.forClip('c');
    const one = await replay.complete(request('first'));
    expect(one.ok && one.value.status === 'answered' && one.value.text).toBe('one');
    const two = await replay.complete(request('changed', 'CCCC', 'A new prompt.'));
    expect(two.ok && two.value.status === 'answered' && two.value.text).toBe('two');
    expect(replay.counts()).toEqual({ answered: 2, otherText: 1, otherFrame: 1, otherPrompt: 1 });
  });

  it('fails a request it has no answer for', async () => {
    const replay = replayingModels(await recorded());
    replay.forClip('missing');
    const answer = await replay.complete(request('first'));
    expect(!answer.ok && answer.error.code).toBe('evals.find_describe_not_recorded');
  });
});
