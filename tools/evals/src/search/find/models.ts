// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The describing model for the find eval, as core's BackgroundModels (the port vision's describe stage asks in the
 * jobs process), so the app's own stage builds every request, parses every answer and stores the descriptions.
 *
 * - `recordingModels` asks a local Ollama server's vision model (Qwen 3.5 4B, the model the app runs on device
 *   through llama.cpp) and keeps each answer with the request it answered.
 * - `replayingModels` answers from such a recording, offline: request n of a clip gets answer n of that clip.
 *   A request whose text differs from the recorded one (another prompt, other context) or whose frame has other
 *   pixels is counted, so a report can say how faithful the replay was; one with no answer fails the stage.
 *
 * Neither is a product path: the app never talks to Ollama unless the person sets it up under Advanced.
 */
import { createHash } from 'node:crypto';
import {
  defineError,
  err,
  ok,
  type AsyncResult,
  type BackgroundModelRequest,
  type BackgroundModelResult,
  type BackgroundModels,
} from '@taalcut/core';
import type { RecordedAnswer, RecordingFile } from './schema';

export const DescribeNotRecorded = defineError('evals.find_describe_not_recorded', { retryable: false });
export const DescribeModelFailed = defineError('evals.find_describe_model_failed', { retryable: false });

/** Models that know which clip the describe stage is on: it asks for one asset at a time. */
export interface ClipModels extends BackgroundModels {
  forClip(clip: string): void;
}

export const promptId = (system: string) => createHash('sha256').update(system).digest('hex').slice(0, 12);

function parts(request: BackgroundModelRequest): { text: string; images: string[] } {
  const text = request.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n\n');
  const images = request.content.flatMap((part) => (part.type === 'image' ? [part.data] : []));
  return { text, images };
}

const frameHash = (images: readonly string[]) => createHash('sha256').update(images.join('|')).digest('hex');

export interface OllamaOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly fetch?: typeof fetch;
}

const ollamaAnswer = (value: unknown): string | undefined => {
  const message = (value as { message?: { content?: unknown } } | null)?.message;
  return typeof message?.content === 'string' ? message.content : undefined;
};

/** Asks Ollama and records every answer; `recording()` is the file to write. */
export function recordingModels(options: OllamaOptions): ClipModels & {
  recording(now: Date): RecordingFile;
} {
  const answers: RecordedAnswer[] = [];
  let clip = '';
  let n = 0;
  let system = '';
  const send = options.fetch ?? fetch;
  return {
    forClip(next) {
      clip = next;
      n = 0;
    },
    async complete(request): AsyncResult<BackgroundModelResult> {
      const { text, images } = parts(request);
      if (system && system !== request.system)
        return err(
          DescribeModelFailed(undefined, { detail: 'the system prompt changed within one recording' }),
        );
      system = request.system;
      const response = await send(`${options.baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          stream: false,
          think: false,
          options: { temperature: request.temperature ?? 0, num_predict: request.maxTokens, seed: 0 },
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: text, images },
          ],
        }),
      });
      if (!response.ok)
        return err(DescribeModelFailed(undefined, { detail: `Ollama answered ${response.status}` }));
      const answer = ollamaAnswer(await response.json());
      if (answer === undefined)
        return err(DescribeModelFailed(undefined, { detail: 'no message in the answer' }));
      answers.push({ clip, n, text, frame: frameHash(images), answer });
      n += 1;
      return ok({
        status: 'answered',
        text: answer,
        provider: 'ollama',
        model: options.model,
        local: true,
        costUsd: 0,
        uploadedTo: [],
      });
    },
    recording(now) {
      return {
        v: 1,
        prompt: promptId(system),
        system,
        model: { provider: 'ollama', model: options.model, runtime: 'ollama' },
        recordedAt: now.toISOString(),
        answers: [...answers],
      };
    },
  };
}

export interface ReplayCounts {
  readonly answered: number;
  /** Requests whose text (context and ask) differs from the recorded request's. */
  readonly otherText: number;
  /** Requests whose frame has other pixels than the recorded one. */
  readonly otherFrame: number;
  /** Requests whose system prompt differs from the recording's. */
  readonly otherPrompt: number;
}

/** Answers from a recording; `counts()` says how closely the requests matched it. */
export function replayingModels(file: RecordingFile): ClipModels & { counts(): ReplayCounts } {
  const byClip = new Map<string, RecordedAnswer[]>();
  for (const answer of file.answers) byClip.set(answer.clip, [...(byClip.get(answer.clip) ?? []), answer]);
  for (const list of byClip.values()) list.sort((a, b) => a.n - b.n);
  let clip = '';
  let n = 0;
  const counts = { answered: 0, otherText: 0, otherFrame: 0, otherPrompt: 0 };
  return {
    forClip(next) {
      clip = next;
      n = 0;
    },
    async complete(request) {
      const recorded = byClip.get(clip)?.[n];
      if (!recorded)
        return err(
          DescribeNotRecorded(undefined, { detail: `${clip}: no recorded answer for request ${n}` }),
        );
      n += 1;
      const { text, images } = parts(request);
      counts.answered += 1;
      if (text !== recorded.text) counts.otherText += 1;
      if (frameHash(images) !== recorded.frame) counts.otherFrame += 1;
      if (request.system !== file.system) counts.otherPrompt += 1;
      return ok({
        status: 'answered',
        text: recorded.answer,
        provider: file.model.provider,
        model: file.model.model,
        local: true,
        costUsd: 0,
        uploadedTo: [],
      });
    },
    counts: () => ({ ...counts }),
  };
}
