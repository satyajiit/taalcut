// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Round P3-3, content and media requests: who asked on consent and cap cards, pointers on a live run, an empty
 * translated cue, a cleanup plan's fingerprint, font matches beyond the caption fonts, a skill check that
 * sees its input, a tool estimate that may read stored state, Content Credentials from bytes and a generated
 * file's transcript. Everything stored before still parses.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  CAPTION_COMMANDS,
  CAPTION_FONTS,
  captionCommandPayloads,
  cleanupPlanSchema,
  defineSkill,
  defineTool,
  FONT_MATCH_FAMILIES,
  fontMatchSchema,
  isCaptionFont,
  MATCH_ONLY_FONTS,
  newId,
  NO_TOOL_RETRY,
  ok,
  parseCard,
  styleSchema,
  taalcutEventSchema,
  toolSpecProblems,
  type ContentCredentials,
  type CredentialsReading,
  type GeneratedFile,
  type SkillVerifyContext,
  type Transcript,
} from '@taalcut/core';
import { PHASE2_CARDS } from './helpers/card-fixtures';
import { span } from './helpers/documents';
import { style } from './helpers/phase3';

const requester = { kind: 'mcp', sessionId: newId<'McpSession'>(), name: 'Claude Code' } as const;

describe('who asked', () => {
  it('shows on consent and project-cap cards, which still parse without it', () => {
    const consent = {
      type: 'consent',
      version: 1,
      id: 'consent-1',
      runId: newId<'AgentRun'>(),
      approvalId: 'ap-1',
      tool: 'vision.describeFrame',
      upload: { modules: ['vision'], providers: ['google'], files: ['IMG_0418.mov'] },
      options: ['allow-once', 'deny'],
      status: 'pending',
    };
    expect(parseCard(consent).ok).toBe(true);
    const asked = parseCard({ ...consent, requester });
    expect(asked.ok && asked.value.type === 'consent' && asked.value.requester).toEqual(requester);
    expect(parseCard(PHASE2_CARDS.budgetCap).ok).toBe(true);
    const capped = parseCard({ ...PHASE2_CARDS.budgetCap, requester });
    expect(capped.ok && capped.value.type === 'budgetCap' && capped.value.requester).toEqual(requester);
    expect(parseCard({ ...consent, requester: { ...requester, kind: 'agent' } }).ok).toBe(false);
  });
});

describe('a live run', () => {
  it("carries its message's reference pointers from the start", () => {
    const pointer = {
      said: 'at 0:04',
      basis: 'timeline',
      kind: 'range',
      range: span(120, 15),
      templateId: null,
      timelineId: newId<'Timeline'>(),
      slotId: null,
      slotNumber: null,
      clipId: null,
    } as const;
    const started = {
      type: 'agent.runStarted',
      at: 1,
      payload: { runId: newId<'AgentRun'>(), conversationId: newId<'Conversation'>() },
    };
    expect(taalcutEventSchema.safeParse(started).success).toBe(true);
    const withPointers = { ...started, payload: { ...started.payload, pointers: [pointer] } };
    const parsed = taalcutEventSchema.parse(withPointers);
    expect(parsed.type === 'agent.runStarted' && parsed.payload.pointers?.[0]?.range).toEqual(span(120, 15));
    const many = { ...started, payload: { ...started.payload, pointers: Array(11).fill(pointer) } };
    expect(taalcutEventSchema.safeParse(many).success).toBe(false);
  });
});

describe('a translated caption cue', () => {
  it('may be empty, which drops it as captions.editText does', () => {
    const payload = captionCommandPayloads[CAPTION_COMMANDS.applyTranslation];
    const base = { projectId: newId<'Project'>(), timelineId: newId<'Timeline'>(), language: 'hi' };
    const cues = [
      { cueId: newId<'CaptionCue'>(), text: 'गोवा में' },
      { cueId: newId<'CaptionCue'>(), text: '   ' },
    ];
    expect(payload.parse({ ...base, cues }).cues.map((cue) => cue.text)).toEqual(['गोवा में', '']);
    expect(payload.safeParse({ ...base, cues: [] }).success).toBe(false);
  });
});

describe('a cleanup plan', () => {
  const plan = {
    timelineId: newId<'Timeline'>(),
    revision: 3,
    clips: [{ clipId: newId<'TimelineItem'>(), keep: [span(0, 40)], newIds: [], punch: [] }],
    stats: { fillers: 1, pauses: 0, retakes: 0, punchIns: 0, secondsSaved: 0.4 },
  };

  it('may carry the fingerprint of the clips it was planned on; one stored before has none', () => {
    expect(cleanupPlanSchema.parse(plan).clipsFingerprint).toBeUndefined();
    const fingerprint = 'a'.repeat(64);
    expect(cleanupPlanSchema.parse({ ...plan, clipsFingerprint: fingerprint }).clipsFingerprint).toBe(
      fingerprint,
    );
    for (const bad of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)])
      expect(cleanupPlanSchema.safeParse({ ...plan, clipsFingerprint: bad }).success).toBe(false);
  });
});

describe('a font match', () => {
  const match = {
    version: 1,
    family: 'inter',
    captionFont: 'notoSans',
    score: 1,
    metric: 'ssim',
    script: 'latin',
    ranking: [
      { family: 'inter', score: 1 },
      { family: 'notoSans', score: 0.707 },
    ],
    sampleText: 'DAY ONE',
    ocrConfidence: 0.92,
  } as const;

  it('names the best face of all, and the caption font captions draw', () => {
    expect(FONT_MATCH_FAMILIES).toEqual([...CAPTION_FONTS, ...MATCH_ONLY_FONTS]);
    expect(MATCH_ONLY_FONTS).toHaveLength(11);
    expect(MATCH_ONLY_FONTS.some(isCaptionFont)).toBe(false);
    expect(fontMatchSchema.parse(match)).toEqual(match);
    // A face render can't draw needs the caption font beside it.
    const { captionFont: _drawn, ...noCaption } = match;
    expect(fontMatchSchema.safeParse(noCaption).success).toBe(false);
    // A drawable winner is the caption font itself.
    const anton = { ...match, family: 'anton', captionFont: 'poppins' };
    expect(fontMatchSchema.safeParse(anton).success).toBe(false);
    expect(fontMatchSchema.parse({ ...anton, captionFont: 'anton' }).captionFont).toBe('anton');
  });

  it('stored before round P3-3 (a caption font, no captionFont) reads with its family as the caption font', () => {
    const stored = {
      version: 1,
      family: 'anton',
      score: 0.71,
      metric: 'ssim',
      script: 'latin',
      ranking: [{ family: 'anton', score: 0.71 }],
      sampleText: 'DAY ONE',
      ocrConfidence: 0.9,
    };
    expect(fontMatchSchema.parse(stored)).toEqual({ ...stored, captionFont: 'anton' });
    const doc = JSON.parse(JSON.stringify({ ...style(), kind: 'look', fontMatch: stored }));
    expect(styleSchema.parse(doc).fontMatch?.captionFont).toBe('anton');
  });

  it("converts to JSON Schema both ways, as a tool's output does", () => {
    for (const io of ['input', 'output'] as const)
      expect(() => z.toJSONSchema(fontMatchSchema, { io, unrepresentable: 'throw' })).not.toThrow();
  });
});

describe('ports a lane asked to widen', () => {
  it("give a skill's check the step's input", async () => {
    const input = z.object({ slots: z.array(z.string()) });
    const seen: unknown[] = [];
    const skill = defineSkill({
      id: 'demo.gaps',
      version: '1.0.0',
      labelKey: 'skills.demo.gaps',
      description: 'Fills gaps.',
      prompt: 'Fill the gaps.',
      tools: { names: [] },
      input,
      output: z.object({ filled: z.int() }),
      refs: () => [],
      verify: async (_output, ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<SkillVerifyContext<{ slots: string[] }>>();
        seen.push(ctx.input?.slots);
        return ok({ verdict: 'pass' as const });
      },
    });
    const context = { runId: newId<'AgentRun'>(), projectId: null, flowId: null, stepId: 's1' };
    const signal = new AbortController().signal;
    await skill.verify?.({ filled: 1 }, { ...context, signal, input: { slots: ['a', 'b'] } });
    await skill.verify?.({ filled: 1 }, { ...context, signal });
    expect(seen).toEqual([['a', 'b'], undefined]);
  });

  it('let a priced tool narrow its bound from stored state, never without the bound', () => {
    const tool = defineTool({
      name: 'demo.voice',
      version: '1.0.0',
      description: 'Voices a draft.',
      input: z.object({ timelineId: z.string() }),
      output: z.object({ ok: z.boolean() }),
      costClass: 'paid',
      sideEffect: 'read',
      timeoutMs: 1000,
      retry: NO_TOOL_RETRY,
      permission: { network: 'internet' },
      estimateCost: () => ({ usd: 0.9, basis: 'at most 3,000 characters' }),
      refineCost: async (_input, ctx) => {
        expectTypeOf(ctx.signal).toEqualTypeOf<AbortSignal>();
        return ok({ usd: 0.12, basis: '400 characters in the draft' });
      },
      run: async () => ok({ ok: true }),
    });
    expect(toolSpecProblems(tool)).toEqual([]);
    const { estimateCost: _bound, ...unbound } = tool;
    expect(toolSpecProblems(unbound).some((problem) => /refineCost/.test(problem))).toBe(true);
  });

  it('read Content Credentials from bytes and carry a generated file’s words (types)', () => {
    const reading: CredentialsReading = { presence: 'absent', summary: null };
    const credentials: ContentCredentials = {
      read: async () => ok(reading),
      readBytes: async (_bytes, mediaType) => {
        expectTypeOf(mediaType).toEqualTypeOf<GeneratedFile['mediaType']>();
        return ok(reading);
      },
    };
    expect(typeof credentials.readBytes).toBe('function');
    const transcript: Transcript = {
      version: 1,
      language: 'en',
      segments: [],
      engine: 'tts',
      model: 'eleven_v3',
      local: false,
      wordTiming: 'native',
    };
    const file: GeneratedFile = {
      bytes: new Uint8Array(1),
      mediaType: 'audio/mpeg',
      fileName: 'voice-1.mp3',
      projectId: null,
      provenance: {
        kind: 'generated',
        generation: 'voice',
        provider: 'elevenlabs',
        model: 'eleven_v3',
        access: 'api-key',
        quality: 'final',
        promptSha256: 'a'.repeat(64),
        voiceId: 'voice-1',
        providerRef: null,
        c2pa: 'absent',
        costUsd: 0.02,
        runId: null,
        createdAt: 0,
      },
      transcript,
    };
    expect(file.transcript?.engine).toBe('tts');
  });
});
