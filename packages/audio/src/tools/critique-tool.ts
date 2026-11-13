// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `audio.critique` (EAR1-A3): earshot's sound scorecard of a mix (a render's sound as an artifact, or a library
 * asset) against the 7 launch films or a template reel's own sound, with timestamped fixes keyed for the
 * catalogue (`audio.critique.fix.*`, values in `params`; a cut without sound names its cut). One
 * `audio.listen.analyse` job in the jobs process (its cache key: content hash, model builds and dtype, listen
 * config). A model not installed yet is downloaded first (the analysis's default); one that can't be installed or
 * run here leaves the critique partial (no realness, no music share) rather than failing. Read only, local, 120 s,
 * retried once; output over 8 KiB is stored as an artifact.
 *
 * EAR1-R2: the fixes carry no ready command. The critic can build one (`CritiqueCommands.hitOnCut`), but this tool
 * hears a sound, not a timeline: it has no project, timeline or hits to build an `sfx.setHits` from, so the agent
 * takes a fix's cut to `sfx.addHits` or `sfx.generateHit`. A `templateId` without a profile means the reference
 * profile (the template reel's own sound); with `profile: 'launch'` it is refused.
 */
import { z } from 'zod';
import {
  defineTool,
  err,
  frameRateSchema,
  ok,
  RationalTime,
  rationalTimeJsonSchema,
  SOUND_CRITIQUE_METRICS,
  SOUND_CRITIQUE_PROFILES,
  SOUND_CRITIQUE_VERDICTS,
  soundCritiqueMetricSchema,
  ulidSchema,
  type AnyTool,
  type TemplateId,
  type TemplateListening,
  type ToolContextBase,
} from '@taalcut/core';
import { ListenBadInput, ListenUnavailable } from '../listen/errors';
import { runListenAnalyse } from '../listen/jobs';
import { listenWithin } from './listen-detach';
import { LISTEN_TOOL, spillOver } from './listen-search-tools';
import {
  listenSourceSchema,
  realnessJsonSchema,
  realnessOut,
  resolveAll,
  spilledSchema,
  type ListenQaToolDeps,
  type ListenSourceInput,
} from './listen-tool-sources';

export const critiqueInputSchema = z
  .object({
    source: listenSourceSchema.describe('The mix: a render’s sound as an audio artifact, or a library asset'),
    profile: z
      .enum(['launch', 'reference'])
      .optional()
      .describe(
        'launch: 7 professional launch films (the default without templateId); reference: the template reel’s own sound',
      ),
    templateId: ulidSchema('Template')
      .optional()
      .describe('Score against this template’s reel (profile reference, implied)'),
    cuts: z.array(z.number().min(0).max(3600)).max(2000).optional().describe('The picture’s cuts, seconds'),
    frameRate: frameRateSchema.optional(),
  })
  .refine((input) => input.profile !== 'reference' || input.templateId !== undefined, {
    message: 'A reference critique needs templateId',
  })
  .refine((input) => input.profile !== 'launch' || input.templateId === undefined, {
    message: 'templateId scores against the template’s reel: leave out profile launch, or the templateId',
    path: ['templateId'],
  });

/** The profile asked for: a template means its reel (EAR1-R2), else the launch films. */
export const critiqueProfileOf = (input: {
  readonly profile?: 'launch' | 'reference' | undefined;
  readonly templateId?: unknown;
}): 'launch' | 'reference' => input.profile ?? (input.templateId !== undefined ? 'reference' : 'launch');

/** Core's SoundCritique, its times as plain JSON (the tool's schema must be JSON Schema). */
const critiqueJsonSchema = z.object({
  profile: z.enum(SOUND_CRITIQUE_PROFILES),
  verdict: z.enum(SOUND_CRITIQUE_VERDICTS),
  score: z.number().min(0).max(1),
  partial: z.boolean(),
  metrics: z.array(soundCritiqueMetricSchema).max(SOUND_CRITIQUE_METRICS.length),
  fixes: z
    .array(
      z.object({
        metricId: z.enum(SOUND_CRITIQUE_METRICS).optional(),
        messageKey: z.string().describe('audio.critique.fix.* or .tip.*: what to do, with params'),
        params: z.record(z.string(), z.union([z.string(), z.number()])),
        at: rationalTimeJsonSchema.optional().describe('Where in the mix it applies'),
        command: z.object({ name: z.string(), payload: z.unknown() }).optional(),
      }),
    )
    .max(30),
});

const critiqueFull = z.object({
  critique: critiqueJsonSchema.nullable().describe('Null: under 3 s, or near silence'),
  realness: realnessJsonSchema.nullable(),
});
export const critiqueOutputSchema = z.union([critiqueFull, spilledSchema]);

const MS = { num: 1000, den: 1 } as const;

function critiqueLine(out: z.output<typeof critiqueFull>): string {
  const c = out.critique;
  if (!c) return 'Not critiqued: under 3 s or near silence.';
  const issues = c.metrics.filter((m) => m.status === 'low' || m.status === 'high').length;
  return (
    `${c.verdict.replace(/_/g, ' ')} against ${c.profile === 'launch' ? 'launch films' : 'the reel'} ` +
    `(${Math.round(c.score * 100)}%${c.partial ? ', partial' : ''}): ${issues} out of range, ` +
    `${c.fixes.length} fix${c.fixes.length === 1 ? '' : 'es'}.`
  );
}

export function critiqueTool(deps: ListenQaToolDeps): AnyTool {
  return defineTool({
    name: 'audio.critique',
    version: '1.0.0',
    summary:
      'Sound check of a video’s mix: does sound land on the cuts, on time; loudness; vs launch films or reel.',
    description:
      'Sound check of a video’s mix (a render’s sound as an audio artifact, or a library asset): whether its sound, ' +
      'whooshes and hits land on the cuts (pass the cuts, seconds) and 23 metrics (loudness, true peak, realness, ' +
      'music share, dynamics, opening, ending, density, spectrum, stereo) against 7 launch films or, with ' +
      'templateId, the template reel’s own sound. A verdict (launch grade, close, needs work) and fixes with times ' +
      'and values; a cut without sound names its index in cuts, for sfx.addHits or sfx.generateHit. Output over ' +
      '8 KiB is stored as an artifact.',
    tags: ['sound-check', 'check', 'critique', 'sync', 'cuts', 'timing', 'whoosh', 'loudness', 'listen'],
    input: critiqueInputSchema,
    output: critiqueOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: LISTEN_TOOL.timeoutMs,
    retry: LISTEN_TOOL.retry,
    cache: false,
    permission: { network: 'none', filesystem: { read: ['library', 'scratch'], write: ['scratch'] } },
    summarize: (output) => ('summary' in output ? output.summary : critiqueLine(output)),
    run: async (input, ctx: ToolContextBase) => {
      const profile = critiqueProfileOf(input);
      let reference: TemplateListening | undefined;
      if (profile === 'reference') {
        if (!deps.templateListening) return err(ListenUnavailable({ reason: 'no_templates' }));
        const heard = await deps.templateListening(input.templateId as TemplateId);
        if (!heard.ok) return heard;
        if (!heard.value) {
          return err(ListenBadInput(undefined, { detail: 'the template’s reel has not been heard' }));
        }
        reference = heard.value;
      }
      const resolved = await resolveAll([input.source as ListenSourceInput], deps, ctx.artifacts);
      if (!resolved.ok) return resolved;
      const { refs, done } = resolved.value;
      const ref = refs[0];
      if (!ref) {
        await done();
        return err(ListenBadInput(undefined, { detail: 'no source' }));
      }
      const analysed = await listenWithin(
        ctx.signal,
        (signal) =>
          runListenAnalyse(
            deps.jobs,
            {
              path: ref.path,
              ...(ref.range ? { range: ref.range } : {}),
              want: { measures: true, events: true, realness: true },
              ...(input.cuts ? { cuts: input.cuts.map((s) => RationalTime.fromSeconds(s, MS)) } : {}),
              ...(input.frameRate ? { frameRate: input.frameRate } : {}),
              critique: { profile, ...(reference ? { reference } : {}) },
              optionalModels: true,
            },
            { signal },
          ),
        { cleanup: done },
      );
      if (!analysed.ok) return analysed;
      const out = { critique: analysed.value.critique, realness: realnessOut(analysed.value.realness) };
      const spilled = await spillOver(out, critiqueLine(out), ctx.artifacts);
      return spilled.ok ? ok(spilled.value) : spilled;
    },
  });
}
