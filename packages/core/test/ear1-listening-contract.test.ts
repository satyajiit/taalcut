// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EAR1-K0's contract: listening, its reports, the template's listening, the port, the QA ids, bank provenance. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  audioProfileSchema,
  audioSetLabelSchema,
  CUT_SYNC_MISSES,
  CUT_SYNC_STATUSES,
  cutSyncReportSchema,
  HINT_CATEGORIES,
  isHintCategory,
  LISTEN_VERDICTS,
  listenModelSchema,
  ok,
  QA_CHECK_IDS,
  qaCheckIdSchema,
  renderListeningSchema,
  sfxAtCutSchema,
  SOUND_CRITIQUE_METRICS,
  SOUND_TAG_CATEGORIES,
  soundAuditReportSchema,
  soundCritiqueSchema,
  soundEventSchema,
  soundEventTagSchema,
  soundMeasuresSchema,
  soundRealnessSchema,
  soundSectionSchema,
  soundTagSchema,
  SoundListenerToken,
  telemetryEventSchema,
  TEMPLATE_LISTENING_EVENTS_MAX,
  TEMPLATE_SCHEMA_VERSION,
  templateListeningSchema,
  templateSchema,
  type SoundListener,
  type Template,
} from '@taalcut/core';
import { formatTemplate, issuePaths, json, manualTemplate, referenceTemplate } from './helpers/documents';
import * as L from './helpers/listening';

/** parse(serialize(x)) is x, and serialises to the same JSON. */
function roundTrips<T>(schema: { parse(value: unknown): T }, value: T) {
  const parsed = schema.parse(json(value));
  expect(parsed).toEqual(value);
  expect(json(parsed)).toEqual(json(value));
}

describe('EAR1-K0: listening schemas round-trip', () => {
  it.each([
    ['a validated tag', soundTagSchema, L.whooshTag],
    ['a hint', soundTagSchema, L.genreHint],
    ['an AudioSet label', audioSetLabelSchema, { label: 'Speech', score: 0.5 }],
    ['an event tag', soundEventTagSchema, { term: 'a heavy thud', kind: 'hit', z: 2.2 }],
    ['the model', listenModelSchema, L.MODEL],
    ['the model without AST', listenModelSchema, { clap: L.MODEL.clap, ast: null, dtype: 'int8' }],
    ['measures', soundMeasuresSchema, L.measures()],
    ['near-silent measures', soundMeasuresSchema, L.silentMeasures()],
    ['a hit', soundEventSchema, L.hit()],
    ['a swell', soundEventSchema, L.swell()],
    ['a section', soundSectionSchema, L.section()],
    ['a cut sync report', cutSyncReportSchema, L.cutSync()],
    ['an audit', soundAuditReportSchema, L.audit()],
    ['a clean audit', soundAuditReportSchema, { ok: true, findings: [] }],
    ['a critique', soundCritiqueSchema, L.critique()],
    ['realness', soundRealnessSchema, L.realness()],
    ['silence', soundRealnessSchema, { pReal: null, verdict: 'silent' }],
    ['an effect at a cut', sfxAtCutSchema, { cutIndex: 4, family: 'impact', offsetMs: 0 }],
    ['a render’s listening', renderListeningSchema, L.renderListening()],
    ['a template’s listening', templateListeningSchema, L.templateListening()],
  ] as const)('%s', (_name, schema, value) => roundTrips(schema as { parse(v: unknown): unknown }, value));

  it('keeps a render heard without models: no critique, realness or model', () => {
    roundTrips(renderListeningSchema, {
      ...L.renderListening(),
      critique: null,
      realness: null,
      model: null,
    });
    roundTrips(templateListeningSchema, {
      ...L.templateListening(),
      model: null,
      sections: [],
      realness: undefined,
    });
  });
});

describe('EAR1-K0: listening invariants', () => {
  it('names the verdicts, the hint categories and the cut statuses', () => {
    expect(LISTEN_VERDICTS).toEqual(['strong', 'plausible', 'weak', 'no_match']);
    expect(HINT_CATEGORIES).toEqual(['music_genre', 'music_mood', 'instruments', 'voice']);
    expect(SOUND_TAG_CATEGORIES.filter(isHintCategory)).toEqual([...HINT_CATEGORIES]);
    expect(CUT_SYNC_STATUSES).toEqual(['ok', 'near', 'swell', 'peak', 'off', 'none']);
    expect(CUT_SYNC_MISSES).toEqual(['peak', 'off', 'none']);
    expect(SOUND_CRITIQUE_METRICS).toHaveLength(23);
  });

  it('never gives a hint a verdict, and a hint category’s tag is always a hint', () => {
    expect(issuePaths(soundTagSchema, { ...L.genreHint, verdict: 'strong' })).toEqual(['verdict']);
    expect(issuePaths(soundTagSchema, { ...L.genreHint, hint: false, verdict: 'weak' })).toEqual(['hint']);
    // A validated category may still be a hint (a tag inside a busy mix), without a verdict.
    expect(issuePaths(soundTagSchema, { ...L.whooshTag, hint: true, verdict: null })).toEqual([]);
    expect(issuePaths(soundTagSchema, { ...L.whooshTag, category: 'genre' })).toEqual(['category']);
  });

  it('holds times, bounds and the audit’s ok to what they say', () => {
    expect(issuePaths(soundSectionSchema, { ...L.section(), end: L.section().start })).toEqual(['end']);
    expect(issuePaths(soundAuditReportSchema, { ...L.audit(), ok: true })).toEqual(['ok']);
    expect(issuePaths(soundAuditReportSchema, { ok: false, findings: [] })).toEqual(['ok']);
    expect(issuePaths(soundRealnessSchema, { pReal: null, verdict: 'real' })).toEqual(['pReal']);
    expect(issuePaths(soundRealnessSchema, { pReal: 0.2, verdict: 'silent' })).toEqual(['pReal']);
    expect(issuePaths(soundEventSchema, { ...L.hit(), at: 1.005 })).toEqual(['at']);
    expect(issuePaths(soundMeasuresSchema, { ...L.measures(), lufs: Number.NEGATIVE_INFINITY })).toEqual([
      'lufs',
    ]);
    expect(issuePaths(soundCritiqueSchema, { ...L.critique(), score: 1.2 })).toEqual(['score']);
    const fix = L.critique().fixes[0]!;
    expect(
      issuePaths(soundCritiqueSchema, { ...L.critique(), fixes: [{ ...fix, messageKey: 'Fix it!' }] }),
    ).toEqual(['fixes.0.messageKey']);
    expect(issuePaths(sfxAtCutSchema, { cutIndex: 0, family: 'boom', offsetMs: 0 })).toEqual(['family']);
  });

  it('caps a template’s events', () => {
    const events = Array.from({ length: TEMPLATE_LISTENING_EVENTS_MAX + 1 }, L.hit);
    expect(issuePaths(templateListeningSchema, { ...L.templateListening(), events })).toEqual(['events']);
    expect(issuePaths(templateListeningSchema, { ...L.templateListening(), version: 2 })).toEqual([
      'version',
    ]);
  });
});

describe('EAR1-K0: Template v1 keeps parsing', () => {
  const reference = json(referenceTemplate()) as { audio: Record<string, unknown> };
  const withListening = (listening: unknown): unknown => ({
    ...reference,
    audio: { ...reference.audio, listening },
  });

  it.each([
    ['reference', referenceTemplate],
    ['format', formatTemplate],
    ['manual', manualTemplate],
  ])('a %s template from before listening parses unchanged, still version 1', (_name, make) => {
    const template = make();
    expect('listening' in template.audio).toBe(false);
    const parsed = templateSchema.parse(json(template));
    expect(parsed).toEqual(template);
    expect(json(parsed)).toEqual(json(template));
    expect(TEMPLATE_SCHEMA_VERSION).toBe(1);
  });

  it('carries the reel’s listening, or null when the breakdown couldn’t listen', () => {
    const heard = templateSchema.parse(withListening(json(L.templateListening()))) as Template;
    expect(heard.audio.listening).toEqual(L.templateListening());
    expect(json(heard)).toEqual(withListening(json(L.templateListening())));
    expect((templateSchema.parse(withListening(null)) as Template).audio.listening).toBeNull();
    expect(issuePaths(templateSchema, withListening({ version: 1 }))).toContain('audio.listening.measures');
  });

  it('moved the audio profile out of template-parts.ts, which is under 400 lines again', () => {
    const parts = readFileSync(
      join(import.meta.dirname, '..', 'src', 'templates', 'template-parts.ts'),
      'utf8',
    );
    expect(parts.split('\n').length - 1).toBeLessThan(400);
    expect(parts).not.toContain('audioProfileSchema');
    roundTrips(audioProfileSchema, referenceTemplate().audio);
  });
});

describe('EAR1-K0: the sound QA checks', () => {
  const SOUND = ['soundOnCuts', 'soundClean', 'soundCritique'] as const;

  it('come after every earlier check, so no id moves', () => {
    expect(QA_CHECK_IDS.slice(38)).toEqual([...SOUND]);
    expect(QA_CHECK_IDS.indexOf('slotGraphics')).toBe(37);
    for (const id of SOUND) expect(qaCheckIdSchema.parse(id)).toBe(id);
  });

  it('are accepted by telemetry’s qa.result', () => {
    const event = { name: 'qa.result', passed: false, firstPass: false, fixLoops: 1, failed: [...SOUND] };
    expect(telemetryEventSchema.parse(event)).toEqual(event);
    const all = { ...event, failed: [...QA_CHECK_IDS] };
    expect(telemetryEventSchema.safeParse(all).success).toBe(true);
  });
});

describe('EAR1-K0: the sound listener port', () => {
  it('is resolved by its token and answers with a render’s listening', async () => {
    expect(SoundListenerToken.key).toBe('core.soundListener');
    const heard: { file: string; cuts: number; profile: string }[] = [];
    const listener: SoundListener = {
      async hearRender(input) {
        heard.push({ file: input.file, cuts: input.cuts.length, profile: input.profile });
        return ok(L.renderListening());
      },
    };
    const reference = L.templateListening();
    const result = await listener.hearRender({
      file: '/tmp/render/draft.mp4',
      cuts: reference.cutSync.items.map((item) => item.at),
      profile: 'reference',
      reference,
    });
    expect(result.ok && renderListeningSchema.parse(json(result.value))).toEqual(L.renderListening());
    expect(heard).toEqual([{ file: '/tmp/render/draft.mp4', cuts: 3, profile: 'reference' }]);
  });
});
