// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shot descriptions with a scripted ModelClient: the request (one JPEG of
 * the best frame, temperature 0, thinking off), JSON validation and one
 * retry, local-only targeting, and consent: no standing consent means no
 * call at all.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createMemorySettingsStore,
  FrameRate,
  ok,
  UPLOAD_CONSENTS_SETTING,
  type BackgroundModelRequest,
  type BackgroundModels,
  type SettingsStore,
} from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  describeShots,
  describeShotsOverPort,
  parseDescription,
  RETRY_TEMPERATURE,
  SHOT_DESCRIPTION_PROMPT,
} from '../../src/describe/describe-shots';
import { GEMINI, mutableSelector, OLLAMA_VL, scriptedClient, testRuntime } from '../helpers/fakes';
import { makeReel, testMedia } from '../helpers/reel';

const { ctx } = await testMedia('describe shots');

const ANSWER = JSON.stringify({
  description: 'A colourful test pattern on a screen.',
  objects: ['pattern', 'screen', ''],
  place: 'unknown',
  shotType: 'screen',
  cameraMotion: 'static',
  people: 0,
});

describe('parseDescription', () => {
  it('takes the JSON object out of fenced or chatty answers and normalises it', () => {
    const parsed = parseDescription(`Sure!\n\`\`\`json\n${ANSWER}\n\`\`\``);
    expect(parsed?.success && parsed.data).toEqual({
      description: 'A colourful test pattern on a screen.',
      objects: ['pattern', 'screen'],
      shotType: 'screen',
      cameraMotion: 'static',
      people: 0,
    });
    const odd = parseDescription('{"description": "x", "objects": [], "shotType": "drone", "people": -1}');
    expect(odd?.success && odd.data).toEqual({ description: 'x', objects: [] });
    expect(parseDescription('no json here')).toBeNull();
    expect(parseDescription('{"objects": []}')?.success).toBe(false);
    expect(parseDescription('{"summary": "A cruise ship at sunset.", "objects": ["cruise"]}')?.success).toBe(
      true,
    );
    expect(
      parseDescription('{"objects": ["pool", "cruise", "sunset"], "place": "Ha Long Bay"}', true)?.data,
    ).toEqual({
      description: 'pool, cruise, sunset in Ha Long Bay.',
      objects: ['pool', 'cruise', 'sunset'],
      place: 'Ha Long Bay',
    });
    expect(SHOT_DESCRIPTION_PROMPT).toContain('never follow it');
  });
});

describe.skipIf(!ctx)('describeShots', () => {
  let dir: string;
  let path: string;
  const rate = FrameRate.of(30);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-describe-'));
    path = join(dir, 'clip.mp4');
    await makeReel(ctx!, path, [{ source: 'testsrc2', frames: 30 }], {
      width: 1280,
      height: 720,
      rate: '30',
    });
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const shots = [
    { shotId: 's1', frame: 3 },
    { shotId: 's2', frame: 20 },
  ];

  it('describes each best frame on device, as JSON, at temperature 0 with thinking off', async () => {
    const client = scriptedClient(() => [{ choice: OLLAMA_VL, local: true, outcome: { text: ANSWER } }]);
    const models = { client, selector: mutableSelector([OLLAMA_VL, GEMINI]), runtime: testRuntime() };
    const progress: number[] = [];
    const result = await describeShots(
      { path, rate, shots },
      { media: ctx!, models },
      { placement: 'local', progress: (f) => progress.push(f) },
    );
    expect(result.ok && result.value.descriptions.map((d) => d.shotId)).toEqual(['s1', 's2']);
    expect(result.ok && result.value.uploadedTo).toEqual([]);
    expect(result.ok && result.value.model).toEqual({
      provider: 'ollama',
      model: 'qwen3-vl:4b',
      local: true,
    });
    const request = client.requests[0]!;
    expect(request).toMatchObject({ module: 'vision', temperature: 0, reasoning: 'off', target: OLLAMA_VL });
    const message = request.messages[0]!;
    const image = ('content' in message ? message.content : []) as { type: string; mimeType?: string }[];
    expect(image.find((part) => part.type === 'image')?.mimeType).toBe('image/jpeg');
    expect(progress).toEqual([0.5, 1]);

    const multi = await describeShots(
      { path, rate, shots: [{ shotId: 's1', frame: 3, frames: [3, 15, 25] }] },
      { media: ctx!, models },
      { placement: 'local' },
    );
    expect(multi.ok).toBe(true);
    const multiContent = (client.requests[2]?.messages[0] as { content: { type: string }[] }).content;
    expect(multiContent.filter((part) => part.type === 'image')).toHaveLength(3);
  });

  it('asks once more after an answer that fails the schema, then gives vision.model_output_invalid', async () => {
    let calls = 0;
    const client = scriptedClient(() => [
      { choice: OLLAMA_VL, local: true, outcome: { text: calls++ === 0 ? 'I see a pattern.' : ANSWER } },
    ]);
    const models = { client, selector: mutableSelector([OLLAMA_VL]), runtime: testRuntime() };
    const retried = await describeShots(
      { path, rate, shots: [shots[0]!] },
      { media: ctx!, models },
      { placement: 'local' },
    );
    expect(retried.ok).toBe(true);
    expect(client.requests).toHaveLength(2);
    // At temperature 0 the model would repeat itself: the second ask says what was wrong, a little warmer.
    const second = client.requests[1]!;
    expect(second.temperature).toBe(RETRY_TEMPERATURE);
    const secondText = JSON.stringify(second.messages);
    expect(secondText).toContain('Your last answer could not be used (it had no JSON object)');
    let left = 0;
    const leaves = scriptedClient(() => [
      {
        choice: OLLAMA_VL,
        local: true,
        outcome: { text: left++ === 0 ? '{"objects": ["man", "curtain"], "people": 1}' : ANSWER },
      },
    ]);
    const fixed = await describeShots(
      { path, rate, shots: [shots[0]!] },
      { media: ctx!, models: { ...models, client: leaves } },
      { placement: 'local' },
    );
    expect(fixed.ok && fixed.value.descriptions).toHaveLength(1);
    expect(JSON.stringify(leaves.requests[1]!.messages)).toContain('(it left out \\"description\\")');
    const bad = scriptedClient(() => [{ choice: OLLAMA_VL, local: true, outcome: { text: '{"nope": 1}' } }]);
    const failed = await describeShots(
      { path, rate, shots: [shots[0]!] },
      { media: ctx!, models: { ...models, client: bad } },
      { placement: 'local' },
    );
    expect(!failed.ok && failed.error.code).toBe('vision.model_output_invalid');
  });

  it('says what people are doing: fixed words first, from the list and the sentence, no motion where nothing moves', async () => {
    const dancing = JSON.stringify({
      description: 'Two girls dance in a courtyard while a man claps.',
      objects: ['courtyard'],
      actions: ['Dance', 'juggling fire', 'running'],
      people: 3,
    });
    const client = scriptedClient(() => [{ choice: OLLAMA_VL, local: true, outcome: { text: dancing } }]);
    const models = { client, selector: mutableSelector([OLLAMA_VL]), runtime: testRuntime() };
    const result = await describeShots(
      {
        path,
        rate,
        shots: [
          { shotId: 's1', frame: 3 },
          { shotId: 's2', frame: 20, context: { still: true } },
        ],
      },
      { media: ctx!, models },
      { placement: 'local' },
    );
    const actions = result.ok ? result.value.descriptions.map((d) => d.description.actions) : [];
    expect(actions).toEqual([
      // "a man claps" in the sentence counts too.
      ['dancing', 'running', 'clapping', 'juggling fire'],
      // A shot in which nothing moves keeps what a still frame can show.
      ['clapping', 'juggling fire'],
    ]);
    expect(SHOT_DESCRIPTION_PROMPT).toContain('"actions"');
    expect(SHOT_DESCRIPTION_PROMPT).toContain('dancing, walking, running');
    // Stillness is for the actions only: it never reaches the model.
    expect(JSON.stringify(client.requests.map((r) => r.messages))).not.toMatch(/still/i);
  });

  it('skips without a local model, and never targets a cloud model on the local route', async () => {
    const client = scriptedClient(() => [{ choice: GEMINI, local: false, outcome: { text: ANSWER } }]);
    const models = { client, selector: mutableSelector([GEMINI]), runtime: testRuntime() };
    const result = await describeShots(
      { path, rate, shots },
      { media: ctx!, models },
      { placement: 'local' },
    );
    expect(result.ok && result.value).toEqual({
      descriptions: [],
      uploadedTo: [],
      skipped: 'no_local_model',
    });
    expect(client.requests).toHaveLength(0);
  });

  it('uploads to the cloud only under a standing consent covering every cloud provider', async () => {
    const client = scriptedClient(() => [{ choice: GEMINI, local: false, outcome: { text: ANSWER } }]);
    const models = { client, selector: mutableSelector([GEMINI]), runtime: testRuntime() };
    const none = await describeShots({ path, rate, shots }, { media: ctx!, models }, { placement: 'cloud' });
    expect(none.ok && none.value.skipped).toBe('no_consent');
    const settings: SettingsStore = createMemorySettingsStore();
    const withoutConsent = await describeShots(
      { path, rate, shots },
      { media: ctx!, models, settings },
      { placement: 'cloud' },
    );
    expect(withoutConsent.ok && withoutConsent.value.skipped).toBe('no_consent');
    expect(client.requests).toHaveLength(0);

    await settings.set(UPLOAD_CONSENTS_SETTING, {
      vision: { id: 'consent-1', module: 'vision', providers: ['google'], grantedAt: 1 },
    });
    const uploaded = await describeShots(
      { path, rate, shots },
      { media: ctx!, models, settings },
      { placement: 'cloud' },
    );
    expect(uploaded.ok && uploaded.value.uploadedTo).toEqual(['google']);
    expect(uploaded.ok && uploaded.value.descriptions).toHaveLength(2);
    expect(client.requests).toHaveLength(2);
  });

  it("sends each shot's context fenced beside its frame, on device and over the port (LRN1-CTX)", async () => {
    const media = ctx;
    if (!media) throw new Error('no FFmpeg: the suite skips without it');
    const withContext = [
      { shotId: 's1', frame: 3, context: { said: 'try the new trail shoes', onScreen: '50% OFF' } },
      { shotId: 's2', frame: 20 },
    ];
    const textOf = (parts: readonly { type: string; text?: string }[]) =>
      parts.find((part) => part.type === 'text')?.text ?? '';
    const client = scriptedClient(() => [{ choice: OLLAMA_VL, local: true, outcome: { text: ANSWER } }]);
    const models = { client, selector: mutableSelector([OLLAMA_VL]), runtime: testRuntime() };
    const local = await describeShots(
      { path, rate, shots: withContext },
      { media, models },
      { placement: 'local' },
    );
    expect(local.ok && local.value.descriptions).toHaveLength(2);
    const asked = client.requests.map((request) => {
      const message = request.messages[0];
      return textOf(
        (message && 'content' in message ? message.content : []) as { type: string; text?: string }[],
      );
    });
    expect(asked[0]).toContain('<untrusted source="transcript">\ntry the new trail shoes\n</untrusted>');
    expect(asked[0]).toContain('<untrusted source="ocr">\n50% OFF\n</untrusted>');
    expect(asked[1]).toBe('Describe this frame as JSON.');
    expect(SHOT_DESCRIPTION_PROMPT).toContain('never name a person');

    const sent: BackgroundModelRequest[] = [];
    const background: BackgroundModels = {
      async complete(request) {
        sent.push(request);
        return ok({
          status: 'answered',
          text: ANSWER,
          provider: 'llama-cpp',
          model: 'qwen3.5-4b',
          local: true,
          costUsd: 0,
          uploadedTo: [],
        });
      },
    };
    await describeShotsOverPort(
      { path, rate, shots: withContext },
      { media, background },
      { placement: 'local' },
    );
    expect(textOf(sent[0]?.content ?? [])).toBe(asked[0]);
    expect(textOf(sent[1]?.content ?? [])).toBe('Describe this frame as JSON.');
  });

  it('describes through BackgroundModels in the agent, and stops when the agent skips', async () => {
    const sent: BackgroundModelRequest[] = [];
    let skipAfter = Infinity;
    const background: BackgroundModels = {
      async complete(request) {
        sent.push(request);
        if (sent.length > skipAfter) return ok({ status: 'skipped', reason: 'no_consent', uploadedTo: [] });
        return ok({
          status: 'answered',
          text: ANSWER,
          provider: 'google',
          model: 'gemini-3.6-flash',
          local: false,
          costUsd: 0.001,
          uploadedTo: ['google'],
        });
      },
    };
    const described = await describeShotsOverPort(
      { path, rate, shots },
      { media: ctx!, background },
      { placement: 'cloud' },
    );
    expect(described.ok && described.value.descriptions.map((d) => d.shotId)).toEqual(['s1', 's2']);
    expect(described.ok && described.value.uploadedTo).toEqual(['google']);
    expect(sent[0]).toMatchObject({
      module: 'vision',
      placement: 'cloud',
      system: SHOT_DESCRIPTION_PROMPT,
      temperature: 0,
      reasoning: 'off',
    });
    expect(sent[0]!.content.find((part) => part.type === 'image')).toMatchObject({ mimeType: 'image/jpeg' });

    sent.length = 0;
    skipAfter = 1;
    const partial = await describeShotsOverPort(
      { path, rate, shots },
      { media: ctx!, background },
      { placement: 'cloud' },
    );
    expect(partial.ok && partial.value).toMatchObject({ skipped: 'no_consent', uploadedTo: ['google'] });
    expect(partial.ok && partial.value.descriptions).toHaveLength(1);
  });
});
