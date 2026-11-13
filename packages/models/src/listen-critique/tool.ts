// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-X1: `audio.cloudCritique`, earshot's optional audio-LLM critique (`earshot llm`): a second opinion in words
 * from a hosted model that hears the sound. It is defined here because only @taalcut/models calls providers (R26),
 * and named under `audio`, whose module it joins in the app (apps/desktop agent-listen-cloud.ts).
 *
 * It uploads the person's own audio, so it is kept behind their say-so and refused wherever that can't be had:
 * - `external`, `uploads` and the `vision` cloud module: the agent's consent card asks before the first upload, at
 *   every autonomy level, and the executor never runs it without that approval (PRD G9). `alwaysAsk` too. The upload
 *   names its media, `audio`, so only an "Always allow" given for sound covers it, never vision's for frames (EAR1-I5).
 * - `consent.check`: the call itself refuses (`audio.cloud_critique_consent_required`) without a granted consent.
 * - Local only refuses it before anything is encoded, and again just before the upload (P3-B10).
 * - Never on MCP (`exposure.mcp: false`).
 * Only the window's audio leaves, mono and small; never the picture. Each request is one CloudCall row with the
 * bytes it sent (ModelClient), so it shows in Settings → Usage.
 */
import { createHash } from 'node:crypto';
import {
  callClock,
  defineTool,
  err,
  fileNameOf,
  FrameRate,
  LocalOnly,
  NO_TOOL_RETRY,
  ok,
  RationalTime,
  type AsyncResult,
  type ToolContextBase,
} from '@taalcut/core';
import type { ContentPart } from '../client/messages';
import type { ModelChoice } from '../modules';
import { critiqueSummary, normaliseCritique, parseAnswerJson } from './answer';
import { critiqueContext, type CritiqueFacts } from './context';
import { CLOUD_CRITIQUE_MODULE, estimateCritiqueCost, pickCritiqueModel } from './model';
import type { CloudCritiqueDeps, PreparedCritiqueAudio } from './ports';
import { buildCritiquePrompt } from './rubric';
import {
  CLOUD_CRITIQUE_MAX_OUTPUT_TOKENS,
  CLOUD_CRITIQUE_MAX_SECONDS,
  CLOUD_CRITIQUE_TIMEOUT_MS,
  cloudCritiqueInputSchema,
  cloudCritiqueOutputSchema,
  type CloudCritiqueInput,
  type CloudCritiqueOutput,
} from './schema';

export const CLOUD_CRITIQUE_TOOL = 'audio.cloudCritique';

const DESCRIPTION =
  'A second opinion in words on a soundtrack from a hosted audio model (Gemini, through the vision model the ' +
  'person chose): sync, realism, mix balance, loudness, music, what sounds cheap, and timestamped fixes, scored 1-10 ' +
  'against a premium launch film. It UPLOADS the sound (mono audio only, never the picture, at most ' +
  `${CLOUD_CRITIQUE_MAX_SECONDS} s) to Google, so the person is asked first and may say no; Local only refuses it. ` +
  'Use it only when the person wants a cloud opinion; audio.critique and audio.listen judge the sound on this Mac ' +
  'and are measurements. The answer is an opinion, not a measurement: times are approximate, and every fix should ' +
  'be checked with audio.critique or audio.listen before and after. withTimeline also sends this Mac’s listening ' +
  'summary as text; synthIntended says designed or synthesized sound is on purpose; prompt asks a question of ' +
  'your own.';

export function createCloudCritiqueTool(deps: CloudCritiqueDeps) {
  return defineTool({
    name: CLOUD_CRITIQUE_TOOL,
    version: '1.0.0',
    description: DESCRIPTION,
    summary: 'Uploads a sound to Gemini for a critique in words, after the person allows it.',
    tags: ['sound', 'critique', 'mix', 'cloud', 'upload', 'gemini', 'second-opinion'],
    input: cloudCritiqueInputSchema,
    output: cloudCritiqueOutputSchema,
    costClass: 'cloud',
    sideEffect: 'external',
    alwaysAsk: true,
    timeoutMs: CLOUD_CRITIQUE_TIMEOUT_MS,
    // A retry would upload the sound again.
    retry: NO_TOOL_RETRY,
    permission: {
      filesystem: { read: ['library', 'scratch'], write: ['scratch'] },
      network: 'internet',
      cloudModules: [CLOUD_CRITIQUE_MODULE],
      // Sound, not frames: vision's "Always allow" for frames doesn't cover it; it asks for its own (EAR1-I5).
      uploads: { what: 'user-media', consent: 'first-use', media: 'audio' },
    },
    exposure: { mcp: false },
    idempotencyKey: critiqueKey,
    estimateCost: (input) => estimateCritiqueCost(deps, input),
    summarize: (output) => output.summary,
    describeCall: (_input, output) => {
      const seconds =
        RationalTime.toSeconds(output.uploaded.end) - RationalTime.toSeconds(output.uploaded.start);
      return `${fileNameOf(output.source)} · ${callClock(seconds)}`;
    },
    run: (input, ctx) => runCritique(deps, input, ctx),
  });
}

/** One upload per source, window, question and flags in a run: a repeat returns the first answer. */
export function critiqueKey(input: CloudCritiqueInput): string {
  const source = input.assetId ? `asset:${input.assetId}` : `artifact:${input.artifactId ?? ''}`;
  const range = input.range
    ? `${RationalTime.toSeconds(input.range.start)}+${RationalTime.toSeconds(input.range.duration)}`
    : 'all';
  const question = input.prompt ? createHash('sha256').update(input.prompt).digest('hex').slice(0, 16) : '-';
  const flags = `${input.withTimeline ? 't' : '-'}${input.synthIntended ? 's' : '-'}`;
  return `${source}:${range}:${flags}:${question}`;
}

async function runCritique(
  deps: CloudCritiqueDeps,
  input: CloudCritiqueInput,
  ctx: ToolContextBase,
): AsyncResult<CloudCritiqueOutput> {
  // Nothing of the person's leaves the Mac with Local only on, and no model here can hear (P3-B10).
  if (deps.localOnly()) return err(LocalOnly({ what: 'upload' }));
  const picked = pickCritiqueModel(deps.chain());
  if (!picked.ok) return picked;
  const consent = await deps.consent.check({
    callId: ctx.callId,
    ...(ctx.runId ? { runId: ctx.runId } : {}),
  });
  if (!consent.ok) return consent;

  ctx.reportProgress(0.05, 'encoding');
  // The input schema holds exactly one of the two.
  const source = input.assetId ? { assetId: input.assetId } : { artifactId: input.artifactId };
  const prepared = await deps.audio.prepare(source, {
    ...(input.range ? { range: input.range } : {}),
    maxSeconds: CLOUD_CRITIQUE_MAX_SECONDS,
    artifacts: ctx.artifacts,
    signal: ctx.signal,
  });
  if (!prepared.ok) return prepared;
  try {
    return await critiqueClip(deps, input, ctx, picked.value, prepared.value);
  } finally {
    await prepared.value.done();
  }
}

/**
 * pi-ai 1.4.0 has no audio content block. Its Gemini adapter sends any non-text user part as `inlineData` with the
 * part's MIME type, which is how Gemini's API takes audio, so the audio rides in the image part's shape. Only
 * AUDIO_INPUT_PROVIDERS get it (model.ts); the recorded-response test pins the wire form.
 */
function audioPart(audio: PreparedCritiqueAudio): ContentPart {
  return { type: 'image', data: Buffer.from(audio.bytes).toString('base64'), mimeType: audio.mimeType };
}

async function critiqueClip(
  deps: CloudCritiqueDeps,
  input: CloudCritiqueInput,
  ctx: ToolContextBase,
  choice: ModelChoice,
  audio: PreparedCritiqueAudio,
): AsyncResult<CloudCritiqueOutput> {
  ctx.reportProgress(0.15, 'listening on this Mac');
  const withTimeline = input.withTimeline === true;
  // The measurements are what keep the answer's loudness numbers honest (the rubric says never to guess them), so
  // without them nothing is sent.
  const facts = await audio.facts({ timeline: withTimeline, signal: ctx.signal });
  if (!facts.ok) return facts;
  const notes = noteList(facts.value, withTimeline);
  const prompt = buildCritiquePrompt({
    context: critiqueContext(audio.window, facts.value),
    ...(input.prompt ? { question: input.prompt } : {}),
    ...(input.synthIntended ? { synthIntended: true } : {}),
  });

  // Once more just before the upload: the switch may have been turned on while this Mac listened.
  if (deps.localOnly()) return err(LocalOnly({ what: 'upload' }));
  ctx.reportProgress(0.35, 'asking the hosted model');
  const answered = await deps.models.complete({
    module: CLOUD_CRITIQUE_MODULE,
    target: choice,
    messages: [{ role: 'user', content: [audioPart(audio), { type: 'text', text: prompt }] }],
    maxTokens: CLOUD_CRITIQUE_MAX_OUTPUT_TOKENS,
    signal: ctx.signal,
    trace: { ...(ctx.runId ? { runId: ctx.runId } : {}), spanId: ctx.callId },
  });
  if (!answered.ok) return answered;
  const result = answered.value;
  ctx.reportUsage({
    usd: result.usage.costUsd,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    provider: result.provider,
    model: result.model,
  });

  const window = audio.window;
  const clip = { startS: window.startS, seconds: window.endS - window.startS };
  const parsed = parseAnswerJson(result.text);
  const critique = parsed ? normaliseCritique(parsed, clip) : null;
  const trimmed = audio.trimmed
    ? ` (only ${Math.round(clip.seconds)} s from ${callClock(window.startS)} was sent; give a range for another part)`
    : '';
  const summary = critique
    ? critiqueSummary(result.model, critique, trimmed)
    : `${result.model} answered, but not in JSON (stop: ${result.stopReason}); the start of it is in raw${trimmed}.`;
  const ms = (seconds: number) => RationalTime.of(Math.round(seconds * 1000), FrameRate.of(1000, 1));
  return ok({
    source: fileNameOf(audio.name).slice(0, 300),
    provider: result.provider,
    model: result.model,
    uploaded: {
      bytes: audio.bytes.byteLength,
      codec: window.codec.slice(0, 60),
      start: ms(window.startS),
      end: ms(window.endS),
      trimmed: audio.trimmed,
      withTimeline: withTimeline && facts.value.timeline !== undefined,
    },
    critique,
    ...(critique ? {} : { raw: result.text.slice(0, 4000) }),
    summary,
    notes,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd: result.usage.costUsd,
    },
  });
}

/** What was left out of the context, for the agent and the person. */
function noteList(facts: CritiqueFacts, withTimeline: boolean): string[] {
  const notes = [...facts.notes];
  if (withTimeline && !facts.timeline)
    notes.unshift('the listening summary was not sent: this Mac could not make it');
  if (!facts.measures) notes.unshift('no loudness was measured, so none was sent');
  return notes.slice(0, 5).map((note) => note.slice(0, 300));
}
